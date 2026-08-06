import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import ffmpegStatic from 'ffmpeg-static';
import { audioNeedsTranscode } from './audio-support.js';
import { userDataDir } from './config.js';

/**
 * Makes files playable whose *audio* Chromium refuses.
 *
 * Measured against this Electron rather than assumed: HEVC and Matroska both
 * play natively here, so the container is not the problem it is often taken
 * for. AC-3, E-AC-3, DTS and TrueHD are the real gaps, and they are common in
 * BluRay rips.
 *
 * The video stream is always copied, never re-encoded — that keeps a 700MB
 * episode at roughly ten seconds instead of many minutes, and avoids throwing
 * away quality to fix a soundtrack.
 */

/**
 * Ceiling for the converted-video cache.
 *
 * Entries are full-size copies — a 700MB episode yields a 700MB mp4 — so
 * without a cap this grows without bound and silently eats the disk. Rebuilding
 * an evicted entry costs about ten seconds, which is a cheap trade.
 */
const CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Every ffmpeg process this module has started and not yet reaped.
 *
 * Tracked so they can be killed on quit: a conversion left running holds a file
 * handle and burns CPU after the window is gone, and on Windows the orphan
 * keeps the install directory locked against an update.
 */
const running = new Set<ReturnType<typeof spawn>>();

/** Stops any conversion still in flight. Called when the app is quitting. */
export function stopConversions(): void {
  for (const child of running) child.kill();
  running.clear();
}

/**
 * Deletes the least recently used entries until the cache fits.
 *
 * Access time is not reliable across platforms, so this uses mtime: entries are
 * written once and never modified, making it a faithful "when was this made".
 */
export async function pruneCache(maxBytes = CACHE_MAX_BYTES): Promise<void> {
  const dir = remuxCacheDir();
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const files = [];
  for (const name of entries) {
    const full = join(dir, name);
    const info = await stat(full).catch(() => null);
    if (info?.isFile()) files.push({ full, size: info.size, mtimeMs: info.mtimeMs });
  }

  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= maxBytes) return;

  // Oldest first, dropping entries until the total is back under the ceiling.
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break;
    await unlink(file.full).catch(() => undefined);
    total -= file.size;
  }
}

export function remuxCacheDir(): string {
  return join(userDataDir(), 'cache', 'remux');
}

/**
 * Resolves the bundled ffmpeg.
 *
 * electron-builder packs dependencies into `app.asar`, which a child process
 * cannot execute. The binary is unpacked via `asarUnpack`, so the path has to
 * be redirected to match.
 */
export function ffmpegPath(): string | null {
  const raw = ffmpegStatic as unknown as string | null;
  return raw === null ? null : raw.replace('app.asar', 'app.asar.unpacked');
}

/** Same input always yields the same cache entry; a changed file yields a new one. */
function cacheKey(path: string, size: number, mtimeMs: number): string {
  return `${createHash('sha1').update(`${path}:${size}:${mtimeMs}`).digest('hex').slice(0, 16)}.mp4`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface PrepareResult {
  /** What the player should load — the original when nothing was needed. */
  path: string;
  /** True when a converted copy is being served instead of the original. */
  converted: boolean;
  error: string | null;
}

/**
 * Returns a playable path, converting the audio first if necessary.
 *
 * The result is cached under userData, so the wait is paid once per file. The
 * write goes to a `.part` and is renamed on success, so an interrupted run
 * cannot leave a truncated file that would later be served as if complete.
 */
export async function prepareVideo(
  path: string,
  size: number,
  mtimeMs: number,
  onProgress?: (fraction: number) => void
): Promise<PrepareResult> {
  if (!(await audioNeedsTranscode(path))) {
    return { path, converted: false, error: null };
  }

  const dir = remuxCacheDir();
  const target = join(dir, cacheKey(path, size, mtimeMs));
  if (await exists(target)) return { path: target, converted: true, error: null };

  const ffmpeg = ffmpegPath();
  if (ffmpeg === null) {
    return { path, converted: false, error: 'The bundled converter is missing from this build.' };
  }

  await mkdir(dir, { recursive: true });
  const partial = `${target}.part`;

  try {
    await runFfmpeg(ffmpeg, path, partial, onProgress);
    await rename(partial, target);
    // After writing, not before: the new entry is the one that may overflow.
    await pruneCache();
    return { path: target, converted: true, error: null };
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    return {
      path,
      converted: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function runFfmpeg(
  ffmpeg: string,
  input: string,
  output: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-nostdin',
      '-v', 'error',
      // Progress needs a duration to measure against.
      '-stats',
      '-y',
      '-i', input,
      // The point of the whole exercise: keep the video bit-for-bit.
      '-c:v', 'copy',
      '-c:s', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      output
    ]);

    running.add(child);
    let durationSec: number | null = null;
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      // Keep the tail only; a failure message is near the end.
      if (stderr.length > 4000) stderr = stderr.slice(-4000);

      const duration = /Duration:\s*(\d+):(\d+):(\d+)/.exec(chunk);
      if (duration) {
        durationSec =
          Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      }

      const time = /time=(\d+):(\d+):(\d+)/.exec(chunk);
      if (time && durationSec !== null && durationSec > 0 && onProgress) {
        const done = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
        onProgress(Math.min(1, done / durationSec));
      }
    });

    child.on('error', (err) => {
      running.delete(child);
      reject(err);
    });
    child.on('close', (code) => {
      running.delete(child);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').pop() ?? `ffmpeg exited with ${code}`));
    });
  });
}
