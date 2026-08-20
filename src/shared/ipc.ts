import type {
  AppConfig,
  DiscordActivity,
  EnrichmentProgress,
  EnrichmentSummary,
  LibraryCatalog,
  MediaKind,
  PrepareResult,
  Profile,
  ProfileState,
  ReviewCandidate,
  SubtitleFile,
  UpdateStatus,
  VideoColourInfo
} from './types.js';

/** IPC channel names. Kept in one place so main and preload cannot drift. */
export const IPC = {
  configGet: 'config:get',
  configSetTmdbKey: 'config:set-tmdb-key',
  configSetLastProfile: 'config:set-last-profile',
  configSetTranslucent: 'config:set-translucent',
  configSetVideoBrightness: 'config:set-video-brightness',
  configSetMovieRoots: 'config:set-movie-roots',
  configSetSeriesRoots: 'config:set-series-roots',
  configPickFolder: 'config:pick-folder',

  libraryGet: 'library:get',
  libraryScan: 'library:scan',
  libraryEnrich: 'library:enrich',
  libraryFetchNew: 'library:fetch-new',
  libraryEnrichProgress: 'library:enrich-progress',
  libraryRematch: 'library:rematch',
  libraryBackdropFull: 'library:backdrop-full',
  librarySearchProvider: 'library:search-provider',
  subtitleLoad: 'player:subtitle-load',
  subtitleRescan: 'player:subtitle-rescan',
  videoPrepare: 'player:video-prepare',
  videoPrewarm: 'player:video-prewarm',
  subtitleEmbedded: 'player:subtitle-embedded',
  videoPrepareProgress: 'player:video-prepare-progress',
  videoColour: 'player:video-colour',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  appVersion: 'app:version',
  openLetterboxd: 'app:open-letterboxd',
  discordSet: 'discord:set',
  configSetDiscord: 'config:set-discord',

  profilesList: 'profiles:list',
  profileCreate: 'profiles:create',
  profileDelete: 'profiles:delete',
  profileRename: 'profiles:rename',
  profileAvatarPick: 'profiles:avatar-pick',
  profileAvatarClear: 'profiles:avatar-clear',
  profileStateGet: 'profiles:state-get',

  watchSet: 'watch:set',
  watchClear: 'watch:clear',
  watchSetFinished: 'watch:set-finished',
  posterChoiceSet: 'watch:poster-choice',
  backdropChoiceSet: 'watch:backdrop-choice'
} as const;

/** The surface exposed on `window.api` by the preload script. */
export interface RendererApi {
  getConfig(): Promise<AppConfig>;
  /** Returns the updated config; the key itself is never read back out. */
  setTmdbKey(key: string | null): Promise<AppConfig>;
  setLastProfile(profileId: string | null): Promise<AppConfig>;
  /** Applies immediately — no restart needed. */
  setTranslucent(enabled: boolean): Promise<AppConfig>;
  setVideoBrightness(value: number): Promise<AppConfig>;
  /** Replaces the list of folders scanned for films. */
  setMovieRoots(roots: string[]): Promise<AppConfig>;
  /** Folders scanned for shows; each show is one subfolder. */
  setSeriesRoots(roots: string[]): Promise<AppConfig>;
  /**
   * Opens the native folder chooser. Resolves to null if the user cancels —
   * which is not an error and must not clear the existing roots.
   */
  pickFolder(): Promise<string | null>;

  /** Reads the stored catalog without touching the disk scan. */
  getLibrary(): Promise<LibraryCatalog>;
  /** Rescans library roots and merges the result into the catalog. */
  scanLibrary(): Promise<LibraryCatalog>;
  /** Fetches metadata and artwork for unmatched films. */
  enrichLibrary(force: boolean): Promise<EnrichmentSummary>;
  /**
   * Rescans, then fetches metadata for films that were not in the catalog
   * before — so adding one title costs one lookup, not a pass over the library.
   */
  fetchNewLibrary(): Promise<EnrichmentSummary>;
  /** Forces a film to a specific provider id, overriding the fuzzy match. */
  rematch(movieId: string, remoteId: number): Promise<LibraryCatalog>;

  /**
   * Downloads the full-size version of a backdrop that was only cached as a
   * picker preview, and returns the updated catalog.
   *
   * Backdrops other than the default are stored small — see `CachedImage`. This
   * is what upgrades one when a profile actually puts it on screen. Safe to
   * call for a backdrop that already has its full size, or with no network: it
   * resolves to a catalog either way, leaving the preview in place on failure.
   */
  ensureBackdropFull(movieId: string, index: number): Promise<LibraryCatalog>;
  /**
   * Free-text provider search, for fixing a match the scorer got wrong. `kind`
   * picks the endpoint — a show cannot be found on the film one.
   */
  searchProvider(query: string, year: number | null, kind: MediaKind): Promise<ReviewCandidate[]>;

  /**
   * Reads a subtitle file and returns it as WebVTT. `<track>` rejects SubRip,
   * so conversion happens in main where the file can be read directly.
   */
  loadSubtitle(path: string): Promise<string | null>;

  /**
   * Re-reads a film's folder for subtitle files, for when one is added while
   * the app is open. Cheaper and less alarming than a full library rescan.
   */
  rescanSubtitles(folderPath: string): Promise<SubtitleFile[]>;

  /**
   * Subtitles stored inside the video file, extracted to WebVTT on first use.
   * Matroska routinely carries them and `<track>` cannot read them in place.
   */
  embeddedSubtitles(path: string): Promise<SubtitleFile[]>;

  /**
   * Returns a path the player can actually load. Files whose audio Chromium
   * cannot decode (AC-3, DTS, TrueHD) are converted once and cached; the video
   * stream is copied untouched. Everything else resolves to the original.
   */
  prepareVideo(path: string): Promise<PrepareResult>;

  /**
   * Converts a file the user has not asked for yet, so it is ready when
   * they do. Used on the next episode while the current one plays.
   *
   * Deliberately not `prepareVideo`: that one reports progress, and a
   * background job driving the player’s "Converting audio…" overlay would
   * claim the episode on screen was still loading. Resolves when the work
   * finishes; callers are expected to ignore it.
   */
  prewarmVideo(path: string): Promise<void>;

  /** Reads a file's declared colour tags so the player can spot HDR content. */
  probeVideoColour(path: string): Promise<VideoColourInfo>;

  getAppVersion(): Promise<string>;

  /**
   * Opens a film's Letterboxd page in the system browser.
   *
   * Takes the TMDB id rather than a URL, so the renderer cannot ask the shell
   * to open anything it likes — main builds the address itself. Letterboxd's
   * `/tmdb/{id}` route redirects to the right film, which beats guessing a slug
   * from a title. Films only; Letterboxd does not catalogue television.
   */
  openLetterboxd(tmdbId: number): Promise<void>;
  /** Manual only — nothing checks on its own. */
  checkForUpdate(): Promise<UpdateStatus>;
  /** Downloads the pending update; it installs on quit. */
  downloadUpdate(): Promise<UpdateStatus>;

  /**
   * Publishes what is playing, or clears it when passed null. Resolves to the
   * Discord application's own name once known — it lives in the developer
   * portal, so Discord is the only source for it — or null if not yet.
   */
  setDiscordActivity(activity: DiscordActivity | null): Promise<string | null>;
  setDiscordConfig(enabled: boolean, appId: string | null): Promise<AppConfig>;

  /** Subscribes to conversion progress, 0–1. Returns an unsubscribe function. */
  onPrepareProgress(listener: (fraction: number) => void): () => void;

  /** Subscribes to enrichment progress. Returns an unsubscribe function. */
  onEnrichProgress(listener: (progress: EnrichmentProgress) => void): () => void;

  listProfiles(): Promise<Profile[]>;
  createProfile(name: string): Promise<Profile[]>;
  deleteProfile(id: string): Promise<Profile[]>;
  renameProfile(id: string, name: string): Promise<Profile[]>;
  /**
   * Opens the image chooser and copies the result into the app's own cache.
   * The picking and the copying are one call so the renderer never handles a
   * path from outside the allowed roots. Cancelling changes nothing.
   */
  pickProfileAvatar(id: string): Promise<Profile[]>;
  clearProfileAvatar(id: string): Promise<Profile[]>;
  getProfileState(id: string): Promise<ProfileState>;

  setWatchProgress(
    profileId: string,
    movieId: string,
    positionSec: number,
    durationSec: number
  ): Promise<ProfileState>;
  clearWatchProgress(profileId: string, movieId: string): Promise<ProfileState>;
  /**
   * Marks a film watched, or puts it back in the deck. Distinct from clearing:
   * a cleared entry is forgotten and reappears the moment the film is played
   * again, where a finished one stays out until it is explicitly unmarked.
   */
  setWatchFinished(profileId: string, movieId: string, finished: boolean): Promise<ProfileState>;
  setPosterChoice(profileId: string, movieId: string, index: number): Promise<ProfileState>;
  /** Index into `Metadata.backdrops`, per profile — see `setPosterChoice`. */
  setBackdropChoice(profileId: string, movieId: string, index: number): Promise<ProfileState>;
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
