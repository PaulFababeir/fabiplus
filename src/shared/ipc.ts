import type { AppConfig, ScanResult } from './types.js';

/** IPC channel names. Kept in one place so main and preload cannot drift. */
export const IPC = {
  configGet: 'config:get',
  configSetTmdbKey: 'config:set-tmdb-key',
  libraryScan: 'library:scan'
} as const;

/** The surface exposed on `window.api` by the preload script. */
export interface RendererApi {
  getConfig(): Promise<AppConfig>;
  setTmdbKey(key: string | null): Promise<AppConfig>;
  scanLibrary(): Promise<ScanResult>;
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
