/**
 * Types shared across main, preload and renderer.
 *
 * Anything crossing the IPC boundary must be structured-clonable — plain data
 * only, no class instances, no Dates (ISO strings instead).
 */

export type MediaKind = 'movie' | 'series';

// ---------------------------------------------------------------------------
// Filesystem scan
// ---------------------------------------------------------------------------

export interface VideoFile {
  /** Absolute path on disk. */
  path: string;
  /** Bytes. Used to pick the feature file when a folder holds several videos. */
  size: number;
  /** Lowercase, no leading dot: "mp4", "mkv". */
  ext: string;
}

export interface SubtitleFile {
  path: string;
  /** Best-effort language/name pulled from the filename, e.g. "English". */
  label: string;
}

/** Release tags stripped off a folder name, kept for display and debugging. */
export interface ReleaseTags {
  /** "1080p", "2160p", "720p". */
  resolution: string | null;
  /** "BluRay", "WEBRip", "WEB", "HDRip". */
  source: string | null;
  /** "x264", "x265", "HEVC". */
  codec: string | null;
  /** "10bit". */
  bitDepth: string | null;
  /** "5.1", "7.1". */
  audio: string | null;
  /** Release group, e.g. "YTS.MX". */
  group: string | null;
  /** Everything else: REPACK, HYBRID, REMASTERED, EXTENDED, PROPER... */
  flags: string[];
}

/** Output of parsing a release-style folder name. */
export interface ParsedName {
  /** Cleaned title as shown in the UI before metadata arrives. */
  title: string;
  /** Normalized for provider lookup (punctuation folded, "-" → ":"). */
  searchTitle: string;
  year: number | null;
  tags: ReleaseTags;
  /** The original folder name, untouched. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Metadata (filled in by the enrichment step)
// ---------------------------------------------------------------------------

export interface CastMember {
  name: string;
  character: string;
  order: number;
  profilePath: string | null;
}

export interface CrewMember {
  name: string;
  job: string;
  department: string;
}

/** An image that has been downloaded into the local cache. */
export interface CachedImage {
  /** Provider-side path, used as the cache key. */
  remotePath: string;
  /** Absolute path in the local image cache. */
  localPath: string;
  width: number;
  height: number;
}

export interface Metadata {
  /** Which provider produced this, e.g. "tmdb". */
  providerId: string;
  remoteId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  releaseDate: string | null;
  runtimeMin: number | null;
  tagline: string | null;
  overview: string;
  genres: string[];
  /** Provider's average rating, 0–10. */
  rating: number | null;
  cast: CastMember[];
  crew: CrewMember[];
  /** Up to POSTERS_PER_MOVIE, ranked English-first then by provider vote. */
  posters: CachedImage[];
  backdrop: CachedImage | null;
  fetchedAt: string;
}

export type MatchStrategy = 'exact' | 'title-year' | 'fuzzy' | 'manual' | 'none';

export interface MatchInfo {
  strategy: MatchStrategy;
  /** 0–1. Anything below REVIEW_THRESHOLD gets flagged in the UI. */
  confidence: number;
  /** Set when the user corrected the match by hand. */
  correctedByUser: boolean;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface LibraryItem {
  /** Stable across rescans: hash of the folder path. */
  id: string;
  kind: MediaKind;
  folderPath: string;
  folderName: string;
  video: VideoFile;
  subtitles: SubtitleFile[];
  parsed: ParsedName;
  /** ISO. When this item first entered the catalog. */
  addedAt: string;
  /** ISO. mtime of the video file — used for "recently added" sorting. */
  fileModifiedAt: string;
  metadata: Metadata | null;
  match: MatchInfo | null;
}

export interface LibraryCatalog {
  /** Bumped when the on-disk shape changes, so old files can be migrated. */
  schemaVersion: number;
  /** ISO. */
  scannedAt: string;
  roots: string[];
  items: LibraryItem[];
}

/** Non-fatal problems hit during a scan, surfaced in the UI. */
export interface ScanIssue {
  folderPath: string;
  reason: 'no-video' | 'unreadable' | 'no-year';
  detail: string;
}

export interface ScanResult {
  items: LibraryItem[];
  issues: ScanIssue[];
  /** Milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

/** Streamed to the renderer while a metadata pass runs. */
export interface EnrichmentProgress {
  done: number;
  total: number;
  /** Title currently being looked up. */
  current: string;
  matched: number;
  needsReview: number;
  failed: number;
}

/** One low-confidence match, offered to the user in the re-match dialog. */
export interface ReviewCandidate {
  remoteId: number;
  title: string;
  year: number | null;
  score: number;
  /** Absolute thumbnail URL, or null when the provider has no poster. */
  posterUrl: string | null;
  overview: string;
}

export interface ReviewItem {
  movieId: string;
  folderName: string;
  parsedTitle: string;
  parsedYear: number | null;
  candidates: ReviewCandidate[];
}

export interface EnrichmentSummary {
  total: number;
  matched: number;
  needsReview: number;
  failed: number;
  durationMs: number;
  review: ReviewItem[];
  /** Set when the run stopped early, e.g. a bad API key. */
  fatalError: string | null;
}

// ---------------------------------------------------------------------------
// Profiles and watch state
// ---------------------------------------------------------------------------

export const MAX_PROFILES = 5;

export interface Profile {
  id: string;
  name: string;
  /** Hex accent used for the avatar chip. */
  accent: string;
  createdAt: string;
}

export interface WatchEntry {
  movieId: string;
  positionSec: number;
  durationSec: number;
  /** ISO. Drives Continue Watching ordering. */
  updatedAt: string;
  finished: boolean;
}

export interface ProfileState {
  schemaVersion: number;
  profileId: string;
  /** Keyed by LibraryItem.id. */
  watch: Record<string, WatchEntry>;
  /** Keyed by LibraryItem.id → index into Metadata.posters. */
  posterChoice: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AppConfig {
  schemaVersion: number;
  /** Library roots. Phase 1 wires movies only. */
  movieRoots: string[];
  seriesRoots: string[];
  /** TMDB key. Lives in userData, never in the repo. */
  tmdbApiKey: string | null;
  lastProfileId: string | null;
}

// ---------------------------------------------------------------------------
// Sorting / filtering
// ---------------------------------------------------------------------------

export type SortKey = 'alphabetical' | 'release-date' | 'recently-added';

export interface LibraryQuery {
  kind: MediaKind;
  search: string;
  genre: string | null;
  sort: SortKey;
}
