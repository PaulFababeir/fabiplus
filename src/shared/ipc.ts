import type {
  AppConfig,
  DiscordActivity,
  EnrichmentProgress,
  EnrichmentSummary,
  LibraryCatalog,
  Profile,
  ProfileState,
  ReviewCandidate,
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
  configPickFolder: 'config:pick-folder',

  libraryGet: 'library:get',
  libraryScan: 'library:scan',
  libraryEnrich: 'library:enrich',
  libraryFetchNew: 'library:fetch-new',
  libraryEnrichProgress: 'library:enrich-progress',
  libraryRematch: 'library:rematch',
  librarySearchProvider: 'library:search-provider',
  subtitleLoad: 'player:subtitle-load',
  videoColour: 'player:video-colour',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  appVersion: 'app:version',
  discordSet: 'discord:set',
  configSetDiscord: 'config:set-discord',

  profilesList: 'profiles:list',
  profileCreate: 'profiles:create',
  profileDelete: 'profiles:delete',
  profileRename: 'profiles:rename',
  profileStateGet: 'profiles:state-get',

  watchSet: 'watch:set',
  watchClear: 'watch:clear',
  posterChoiceSet: 'watch:poster-choice'
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
  /** Free-text provider search, for fixing a match the scorer got wrong. */
  searchProvider(query: string, year: number | null): Promise<ReviewCandidate[]>;

  /**
   * Reads a subtitle file and returns it as WebVTT. `<track>` rejects SubRip,
   * so conversion happens in main where the file can be read directly.
   */
  loadSubtitle(path: string): Promise<string | null>;

  /** Reads a file's declared colour tags so the player can spot HDR content. */
  probeVideoColour(path: string): Promise<VideoColourInfo>;

  getAppVersion(): Promise<string>;
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

  /** Subscribes to enrichment progress. Returns an unsubscribe function. */
  onEnrichProgress(listener: (progress: EnrichmentProgress) => void): () => void;

  listProfiles(): Promise<Profile[]>;
  createProfile(name: string): Promise<Profile[]>;
  deleteProfile(id: string): Promise<Profile[]>;
  renameProfile(id: string, name: string): Promise<Profile[]>;
  getProfileState(id: string): Promise<ProfileState>;

  setWatchProgress(
    profileId: string,
    movieId: string,
    positionSec: number,
    durationSec: number
  ): Promise<ProfileState>;
  clearWatchProgress(profileId: string, movieId: string): Promise<ProfileState>;
  setPosterChoice(profileId: string, movieId: string, index: number): Promise<ProfileState>;
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
