import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join, basename, resolve as resolvePath } from 'node:path';

import type {
  LibraryItem,
  MediaKind,
  ScanIssue,
  ScanResult,
  SubtitleFile,
  VideoFile
} from '@shared/types';
import {
  extensionOf,
  isSubtitleFile,
  isVideoFile,
  parseReleaseName,
  subtitleLabel
} from './filename-parser.js';

/**
 * Anything smaller than this is a sample/trailer, not the feature. The
 * smallest real film in a 1080p library still clears a few hundred MB.
 */
const MIN_FEATURE_BYTES = 50 * 1024 * 1024;

/** Subfolders that never hold the feature file. */
const DEPRIORITIZED_DIRS = new Set(['subs', 'subtitles', 'other', 'extras', 'featurettes', 'sample']);

/** Deepest we will descend inside a single movie folder. */
const MAX_DEPTH = 3;

interface FoundFile {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  /** True when the file sits inside Subs/Other/etc. */
  deprioritized: boolean;
}

/** Stable across rescans as long as the folder doesn't move. */
export function itemId(folderPath: string): string {
  return createHash('sha1').update(resolvePath(folderPath).toLowerCase()).digest('hex').slice(0, 12);
}

async function walk(dir: string, depth: number, deprioritized: boolean): Promise<FoundFile[]> {
  if (depth > MAX_DEPTH) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: FoundFile[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      const childDeprioritized = deprioritized || DEPRIORITIZED_DIRS.has(entry.name.toLowerCase());
      out.push(...(await walk(full, depth + 1, childDeprioritized)));
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const info = await stat(full);
      out.push({
        path: full,
        name: entry.name,
        size: info.size,
        mtimeMs: info.mtimeMs,
        deprioritized
      });
    } catch {
      // Locked or vanished mid-scan; skip it.
    }
  }
  return out;
}

/**
 * Picks the feature file: prefer files outside Subs/Other, then largest.
 * Falls back to the largest video anywhere if every candidate is deprioritized.
 */
function pickFeature(files: FoundFile[]): FoundFile | null {
  const videos = files.filter((f) => isVideoFile(f.name));
  if (videos.length === 0) return null;

  const preferred = videos.filter((f) => !f.deprioritized && f.size >= MIN_FEATURE_BYTES);
  const pool = preferred.length > 0 ? preferred : videos;

  return pool.reduce((best, f) => (f.size > best.size ? f : best));
}

function collectSubtitles(files: FoundFile[]): SubtitleFile[] {
  return files
    .filter((f) => isSubtitleFile(f.name))
    .map((f) => ({ path: f.path, label: subtitleLabel(f.name) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function toVideoFile(f: FoundFile): VideoFile {
  return { path: f.path, size: f.size, ext: extensionOf(f.name) ?? '' };
}

/**
 * Scans one library root. Each immediate subdirectory is treated as one title;
 * loose video files sitting directly in the root are accepted too.
 */
export async function scanRoot(root: string, kind: MediaKind = 'movie'): Promise<ScanResult> {
  const started = Date.now();
  const items: LibraryItem[] = [];
  const issues: ScanIssue[] = [];
  const now = new Date().toISOString();

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    return {
      items: [],
      issues: [
        {
          folderPath: root,
          reason: 'unreadable',
          detail: err instanceof Error ? err.message : String(err)
        }
      ],
      durationMs: Date.now() - started
    };
  }

  for (const entry of entries) {
    const full = join(root, entry.name);

    if (entry.isDirectory()) {
      const files = await walk(full, 1, DEPRIORITIZED_DIRS.has(entry.name.toLowerCase()));
      const feature = pickFeature(files);

      if (!feature) {
        issues.push({
          folderPath: full,
          reason: 'no-video',
          detail: `No video file found in "${entry.name}"`
        });
        continue;
      }

      items.push(
        buildItem({
          kind,
          folderPath: full,
          folderName: entry.name,
          feature,
          subtitles: collectSubtitles(files),
          now
        })
      );
      continue;
    }

    // Loose file directly in the root.
    if (entry.isFile() && isVideoFile(entry.name)) {
      try {
        const info = await stat(full);
        if (info.size < MIN_FEATURE_BYTES) continue;
        items.push(
          buildItem({
            kind,
            folderPath: root,
            folderName: entry.name,
            feature: {
              path: full,
              name: entry.name,
              size: info.size,
              mtimeMs: info.mtimeMs,
              deprioritized: false
            },
            subtitles: [],
            now,
            idSeed: full
          })
        );
      } catch {
        // Skip unreadable loose files.
      }
    }
  }

  for (const item of items) {
    if (item.parsed.year === null) {
      issues.push({
        folderPath: item.folderPath,
        reason: 'no-year',
        detail: `No year in "${item.folderName}" — match confidence will be lower`
      });
    }
  }

  items.sort((a, b) => a.parsed.title.localeCompare(b.parsed.title));

  return { items, issues, durationMs: Date.now() - started };
}

function buildItem(args: {
  kind: MediaKind;
  folderPath: string;
  folderName: string;
  feature: FoundFile;
  subtitles: SubtitleFile[];
  now: string;
  idSeed?: string;
}): LibraryItem {
  const { kind, folderPath, folderName, feature, subtitles, now, idSeed } = args;

  // Folder names carry the fullest information. Fall back to the video
  // filename when the folder name parses without a year but the file has one.
  let parsed = parseReleaseName(folderName);
  if (parsed.year === null) {
    const fromFile = parseReleaseName(basename(feature.name));
    if (fromFile.year !== null) {
      parsed = { ...parsed, year: fromFile.year };
    }
  }

  return {
    id: itemId(idSeed ?? folderPath),
    kind,
    folderPath,
    folderName,
    video: toVideoFile(feature),
    subtitles,
    parsed,
    addedAt: now,
    fileModifiedAt: new Date(feature.mtimeMs).toISOString(),
    metadata: null,
    match: null
  };
}

export async function scanRoots(roots: string[], kind: MediaKind = 'movie'): Promise<ScanResult> {
  const started = Date.now();
  const items: LibraryItem[] = [];
  const issues: ScanIssue[] = [];

  for (const root of roots) {
    const result = await scanRoot(root, kind);
    items.push(...result.items);
    issues.push(...result.issues);
  }

  items.sort((a, b) => a.parsed.title.localeCompare(b.parsed.title));
  return { items, issues, durationMs: Date.now() - started };
}
