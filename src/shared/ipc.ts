import type {
  AppConfig,
  EnrichmentProgress,
  EnrichmentSummary,
  LibraryCatalog
} from './types.js';

/** IPC channel names. Kept in one place so main and preload cannot drift. */
export const IPC = {
  configGet: 'config:get',
  configSetTmdbKey: 'config:set-tmdb-key',
  libraryGet: 'library:get',
  libraryScan: 'library:scan',
  libraryEnrich: 'library:enrich',
  libraryEnrichProgress: 'library:enrich-progress'
} as const;

/** The surface exposed on `window.api` by the preload script. */
export interface RendererApi {
  getConfig(): Promise<AppConfig>;
  /** Returns the updated config; the key itself is never read back out. */
  setTmdbKey(key: string | null): Promise<AppConfig>;

  /** Reads the stored catalog without touching the disk scan. */
  getLibrary(): Promise<LibraryCatalog>;
  /** Rescans library roots and merges the result into the catalog. */
  scanLibrary(): Promise<LibraryCatalog>;
  /** Fetches metadata and artwork for unmatched films. */
  enrichLibrary(force: boolean): Promise<EnrichmentSummary>;

  /** Subscribes to enrichment progress. Returns an unsubscribe function. */
  onEnrichProgress(listener: (progress: EnrichmentProgress) => void): () => void;
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
