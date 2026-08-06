import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { SubtitleFile } from '@shared/types';
import { userDataDir } from './config.js';
import { ffmpegPath } from './transcode.js';
import { LANGUAGE_NAMES, parseSubtitleStreams } from './subtitle-streams.js';

/**
 * Pulls subtitle tracks out of a container.
 *
 * A Matroska file routinely carries its subtitles inside it — the sample
 * library's episodes hold six each — and Chromium cannot see them: `<track>`
 * only takes a separate file. VLC showing subtitles the app could not was this
 * gap, not a missing sidecar.
 *
 * Extraction is one ffmpeg pass writing every track at once. Per-track calls
 * would each demux the whole file, turning a few seconds into a minute.
 */

export function subsCacheDir(): string {
  return join(userDataDir(), 'cache', 'subs');
}

function cacheKey(path: string, size: number, mtimeMs: number): string {
  return createHash('sha1').update(`${path}:${size}:${mtimeMs}`).digest('hex').slice(0, 16);
}

/** Reads the container's stream table without decoding anything. */
async function probe(ffmpeg: string, path: string): Promise<string> {
  return new Promise((resolve) => {
    // `-i` with no output makes ffmpeg print the streams and exit non-zero,
    // which is the documented way to inspect a file without ffprobe.
    const child = spawn(ffmpeg, ['-hide_banner', '-i', path]);
    let out = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => {
      out += c;
    });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out));
  });
}

/**
 * Returns the file's embedded subtitles as WebVTT sidecars, extracting them the
 * first time and reusing the cache afterwards.
 *
 * Failure is not an error worth surfacing: a file with no subtitles inside it
 * is the normal case, and the player still has whatever sits next to it on disk.
 */
export async function extractEmbeddedSubtitles(
  path: string,
  size: number,
  mtimeMs: number
): Promise<SubtitleFile[]> {
  const ffmpeg = ffmpegPath();
  if (ffmpeg === null) return [];

  const dir = join(subsCacheDir(), cacheKey(path, size, mtimeMs));

  // A previous extraction wrote everything in one pass, so any content is
  // complete content — no need to re-probe the source.
  const cached = await readdir(dir).catch(() => null);
  if (cached !== null && cached.length > 0) return fromFiles(dir, cached);

  const streams = parseSubtitleStreams(await probe(ffmpeg, path));
  if (streams.length === 0) return [];

  await mkdir(dir, { recursive: true });

  // One pass, one output per track.
  const args = ['-nostdin', '-v', 'error', '-y', '-i', path];
  for (const [i, stream] of streams.entries()) {
    args.push('-map', `0:${stream.index}`, '-c:s', 'webvtt', join(dir, `${i}-${stream.label}.vtt`));
  }

  const ok = await run(ffmpeg, args);
  if (!ok) return [];

  const written = await readdir(dir).catch(() => []);
  return fromFiles(dir, written);
}

function fromFiles(dir: string, names: string[]): SubtitleFile[] {
  return names
    .filter((n) => n.endsWith('.vtt'))
    .sort()
    .map((name) => ({
      path: join(dir, name),
      // "0-English.vtt" → "English". The index only orders the list.
      label: name.replace(/^\d+-/, '').replace(/\.vtt$/, '')
    }));
}

function run(ffmpeg: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, args);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export { LANGUAGE_NAMES };
