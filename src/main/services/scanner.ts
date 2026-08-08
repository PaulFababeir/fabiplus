import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join, basename, resolve as resolvePath } from 'node:path';

import type {
  Episode,
  LibraryItem,
  MediaKind,
  ScanIssue,
  ScanResult,
  Season,
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
import { parseEpisodeName, parseSeasonFolder, parseSeriesFolder } from './episode-parser.js';

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

/**
 * Re-reads one folder for subtitle files.
 *
 * Subtitles are captured at scan time, so a `.srt` dropped in next to a film
 * while the app is open stays invisible until the whole library is rescanned —
 * which is a heavy answer to "I just downloaded subs for this one film". This
 * walks a single folder, at the same depth and with the same Subs/ handling as
 * a full scan, so the result is identical to what a rescan would have found.
 */
export async function rescanSubtitles(folderPath: string): Promise<SubtitleFile[]> {
  return collectSubtitles(await walk(folderPath, 0, false));
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
 * Builds the season list for one show folder.
 *
 * The folder decides which season an episode belongs to; the filename supplies
 * the episode number and title. That split matters for the unnumbered folders
 * real releases carry — the sample library's "Unaired Pilot" holds a file named
 * `S01E00`, and trusting the filename would bury it inside Season 1 instead of
 * showing it as the separate thing the release author clearly intended.
 *
 * Episodes sitting loose in the show root become a single unlabelled season, so
 * a flat show folder still works.
 */
async function collectSeasons(showPath: string): Promise<Season[]> {
  let entries;
  try {
    entries = await readdir(showPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const seasons: Season[] = [];

  const loose = entries.filter((e) => e.isFile() && isVideoFile(e.name));
  if (loose.length > 0) {
    const files = await walk(showPath, MAX_DEPTH, false);
    seasons.push({
      number: null,
      label: 'Episodes',
      episodes: await toEpisodes(
        showPath,
        files.filter((f) => loose.some((l) => l.name === f.name)),
        files
      )
    });
  }

  for (const entry of entries.filter((e) => e.isDirectory())) {
    const seasonPath = join(showPath, entry.name);
    const parsed = parseSeasonFolder(entry.name);
    const files = await walk(seasonPath, 1, false);
    const videos = files.filter((f) => isVideoFile(f.name));
    if (videos.length === 0) continue;

    seasons.push({
      number: parsed.number,
      label: parsed.label,
      episodes: await toEpisodes(seasonPath, videos, files)
    });
  }

  // Numbered seasons first and in order; unnumbered folders trail alphabetically
  // rather than being dropped or jumbled in among them.
  return seasons.sort((a, b) => {
    if (a.number === null && b.number === null) return a.label.localeCompare(b.label);
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  });
}

async function toEpisodes(
  folderPath: string,
  videos: FoundFile[],
  siblings: FoundFile[]
): Promise<Episode[]> {
  const episodes = videos.map((file) => {
    const parsed = parseEpisodeName(file.name);
    return {
      id: itemId(file.path),
      number: parsed.episode,
      title: parsed.title,
      // Neither runtime nor artwork is in the filename; enrichment fills both
      // in, and `mergeScan` carries them across later rescans.
      runtimeMin: null,
      still: null,
      video: toVideoFile(file),
      // Subtitles that sit beside this episode, matched on the filename stem.
      subtitles: collectSubtitles(
        siblings.filter((s) => isSubtitleFile(s.name) && shareStem(s.name, file.name))
      ),
      folderPath
    } satisfies Episode;
  });

  // Unnumbered episodes sort last rather than colliding at position zero.
  return episodes.sort((a, b) => {
    if (a.number === null && b.number === null) return a.video.path.localeCompare(b.video.path);
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  });
}

/**
 * True when a subtitle belongs to a given video, judged by the filename stem.
 * A season folder holds many episodes, so the whole-folder sweep a film gets
 * would hand every episode every language of every other episode.
 */
function shareStem(subtitleName: string, videoName: string): boolean {
  const stem = (n: string): string => n.replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase();
  const video = stem(videoName);
  const sub = stem(subtitleName);
  return sub === video || sub.startsWith(`${video}.`) || sub.startsWith(`${video}_`);
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
      if (kind === 'series') {
        const seasons = await collectSeasons(full);
        const first = seasons.flatMap((s) => s.episodes)[0];

        if (!first) {
          issues.push({
            folderPath: full,
            reason: 'no-video',
            detail: `No episodes found in "${entry.name}"`
          });
          continue;
        }

        items.push(
          buildItem({
            kind,
            folderPath: full,
            folderName: entry.name,
            // The first episode stands in for the show wherever a single file
            // is needed — size, mtime sorting, and playback before the episode
            // picker exists.
            feature: {
              path: first.video.path,
              name: first.video.path.split(/[\\/]/).pop() ?? entry.name,
              size: first.video.size,
              mtimeMs: Date.parse(now),
              deprioritized: false
            },
            subtitles: first.subtitles,
            seasons,
            now
          })
        );
        continue;
      }

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
  /** Series only; a film has none. */
  seasons?: Season[];
  now: string;
  idSeed?: string;
}): LibraryItem {
  const { kind, folderPath, folderName, feature, subtitles, seasons, now, idSeed } = args;

  // Folder names carry the fullest information. Fall back to the video
  // filename when the folder name parses without a year but the file has one.
  // A show folder carries a season range where a film carries release tags,
  // so it needs the series rules or the title keeps the "S01-S04" on the end.
  if (kind === 'series') {
    const show = parseSeriesFolder(folderName);
    return {
      id: itemId(idSeed ?? folderPath),
      kind,
      folderPath,
      folderName,
      video: toVideoFile(feature),
      subtitles,
      seasons: seasons ?? null,
      parsed: { ...parseReleaseName(folderName), title: show.title, year: show.year },
      addedAt: now,
      fileModifiedAt: new Date(feature.mtimeMs).toISOString(),
      metadata: null,
      match: null
    };
  }

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
    seasons: seasons ?? null,
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

/**
 * Scans films and shows together into one catalog.
 *
 * They share a catalog rather than living in separate files because everything
 * downstream — the merge, the metadata guard, watch history — is written
 * against one list, and `kind` is enough to tell them apart. Splitting the
 * storage would mean two of each of those.
 */
export async function scanLibrary(
  movieRoots: string[],
  seriesRoots: string[]
): Promise<ScanResult> {
  const started = Date.now();
  const [movies, series] = await Promise.all([
    scanRoots(movieRoots, 'movie'),
    scanRoots(seriesRoots, 'series')
  ]);

  const items = [...movies.items, ...series.items].sort((a, b) =>
    a.parsed.title.localeCompare(b.parsed.title)
  );

  return {
    items,
    issues: [...movies.issues, ...series.issues],
    durationMs: Date.now() - started
  };
}
