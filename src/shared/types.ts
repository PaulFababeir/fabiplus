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

/**
 * One downloadable subtitle offered by the online provider.
 *
 * `path` is provider-relative, never a URL: main resolves it against the
 * provider it came from, so the renderer cannot point the download at an
 * arbitrary host.
 */
export interface SubtitleOption {
  code: string;
  language: string;
  path: string;
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
  /**
   * Full-resolution copy, for backdrops only.
   *
   * A film caches twenty backdrops but only ever *shows* one, so `localPath`
   * holds a preview sized for the picker grid and this holds the large version
   * — fetched at enrichment for the default, and on demand when a profile picks
   * a different one. Storing twenty originals to display one cost about seven
   * times the disk for pixels nothing drew.
   *
   * Null when the full size has not been fetched, absent entirely on posters,
   * stills, and any catalog written before the split. `backdropFor` falls back
   * to `localPath` in all three cases.
   */
  fullPath?: string | null;
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
  /**
   * Kept so a catalog written before backdrops were selectable still renders;
   * `backdrops[0]` is the same image. Read it through `backdropFor`, never on its own.
   */
  backdrop: CachedImage | null;
  /** Up to BACKDROPS_PER_MOVIE, ranked textless-first. */
  backdrops: CachedImage[];
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

/** Outcome of making a file playable; see `transcode.ts`. */
export interface PrepareResult {
  path: string;
  /** True when a converted copy is served instead of the original. */
  converted: boolean;
  error: string | null;
}

/** One episode file. */
export interface Episode {
  /** Stable across rescans: hash of the file path. */
  id: string;
  /** From the filename; null when no marker could be read. */
  number: number | null;
  /** Recovered from the filename, or supplied later by the provider. */
  title: string | null;
  /** Provider runtime in minutes. Not in the filename, so null until enriched. */
  runtimeMin: number | null;
  /** Episode thumbnail from the provider, cached locally. Null until enriched. */
  still: CachedImage | null;
  video: VideoFile;
  subtitles: SubtitleFile[];
  /** The season folder this file sits in, for a targeted subtitle rescan. */
  folderPath: string;
}

/**
 * A season folder. `number` is null for folders that are not numbered seasons
 * — the sample library has an "Unaired Pilot" holding a real episode, and
 * dropping those would hide watchable content.
 */
export interface Season {
  number: number | null;
  label: string;
  episodes: Episode[];
}

export interface LibraryItem {
  /** Stable across rescans: hash of the folder path. */
  id: string;
  kind: MediaKind;
  folderPath: string;
  folderName: string;
  /**
   * For a film, the feature. For a series, the first episode — a stand-in so
   * size, sorting and playback keep working; `seasons` is the real content.
   */
  video: VideoFile;
  subtitles: SubtitleFile[];
  /** Populated for `kind: 'series'`, null for a film. */
  seasons: Season[] | null;
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

/**
 * What to show on a Discord profile. Field names follow Discord's own, because
 * they map to specific lines and guessing wrong is invisible until you look at
 * a profile: `name` is the first line, `details` the second, `state` the third.
 */
export interface DiscordActivity {
  /**
   * Replaces the application name on the first line. Null keeps the app name,
   * which is what identifies the app while browsing.
   */
  name: string | null;
  /** The verb before `name` — see ACTIVITY_PLAYING / ACTIVITY_WATCHING. */
  type: number;
  details: string;
  state: string;
  /** Drives Discord's countdown; null when the runtime is unknown. */
  remainingSec: number | null;
  /** Asset key uploaded to the Discord application, or null for no artwork. */
  largeImage: string | null;
  /**
   * Tooltip shown when the cursor rests on the artwork.
   *
   * Its own field rather than something derived from `name`/`details`: it is
   * the one place with room for a phrase the three visible lines have no space
   * for, and deriving it meant changing the tooltip could only be done by
   * changing what the card says.
   */
  largeText: string;
}

/** Result of a manual update check. */
export interface UpdateStatus {
  state: 'current' | 'available' | 'downloaded' | 'unavailable' | 'error';
  /** The version currently running. */
  version: string;
  /** Newer version when available, otherwise an explanation or null. */
  detail: string | null;
}

/** Colour description declared by a video file, as far as the player needs. */
export interface VideoColourInfo {
  transfer: number | null;
  /** True when the declared transfer is PQ or HLG, so Chromium tone-maps it. */
  hdr: boolean;
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

export interface Profile {
  id: string;
  name: string;
  /** Hex accent used for the avatar chip, and behind a chosen image. */
  accent: string;
  /**
   * Absolute path to a chosen avatar inside the app's own cache, or null for
   * the accent chip. Copied in rather than referenced where the user picked it,
   * so moving or deleting the original cannot break the profile.
   */
  avatarPath: string | null;
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
  /** Keyed by LibraryItem.id → index into Metadata.backdrops. */
  backdropChoice: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AppConfig {
  schemaVersion: number;
  /** Folders scanned for films. Shows live under `seriesRoots`; both are read. */
  movieRoots: string[];
  seriesRoots: string[];
  /** TMDB key. Lives in userData, never in the repo. */
  tmdbApiKey: string | null;
  lastProfileId: string | null;
  /**
   * Windows 11 acrylic behind the window, so the desktop reads faintly through
   * it. Off means a solid background.
   */
  translucentBackground: boolean;
  /**
   * Multiplier applied to video playback, 1 = untouched. Pinning the colour
   * profile to sRGB fixes most of the gap against VLC; this covers displays
   * where a little more is still wanted.
   */
  videoBrightness: number;
  /**
   * Discord Rich Presence. Off by default — this broadcasts what you are
   * watching to anyone who can see your profile.
   */
  discordPresence: boolean;
  /** Application ID from the Discord developer portal. */
  discordAppId: string | null;
}

// ---------------------------------------------------------------------------
// Sorting / filtering
// ---------------------------------------------------------------------------

export type SortKey = 'alphabetical' | 'release-date' | 'recently-added';

/**
 * What the library view is showing.
 *
 * Deliberately not a `MediaKind`. `all` is a property of the view, not of an
 * item: every `LibraryItem` is exactly one kind, and the provider has separate
 * endpoints per kind with nothing to search for "both". Widening `MediaKind`
 * would put `all` in reach of `searchProvider` and `fetchDetails`, where it
 * means nothing.
 */
export type KindFilter = MediaKind | 'all';

