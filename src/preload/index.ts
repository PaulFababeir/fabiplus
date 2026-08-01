import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC, type RendererApi } from '../shared/ipc.js';
import type {
  AppConfig,
  EnrichmentProgress,
  EnrichmentSummary,
  LibraryCatalog
} from '../shared/types.js';

/**
 * The renderer gets exactly this surface and nothing else — no `fs`, no raw
 * `ipcRenderer`. Every path that reaches the disk is validated in main.
 */
const api: RendererApi = {
  getConfig: () => ipcRenderer.invoke(IPC.configGet) as Promise<AppConfig>,
  setTmdbKey: (key) => ipcRenderer.invoke(IPC.configSetTmdbKey, key) as Promise<AppConfig>,

  getLibrary: () => ipcRenderer.invoke(IPC.libraryGet) as Promise<LibraryCatalog>,
  scanLibrary: () => ipcRenderer.invoke(IPC.libraryScan) as Promise<LibraryCatalog>,
  enrichLibrary: (force) => ipcRenderer.invoke(IPC.libraryEnrich, force) as Promise<EnrichmentSummary>,

  onEnrichProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: EnrichmentProgress): void =>
      listener(progress);
    ipcRenderer.on(IPC.libraryEnrichProgress, handler);
    return () => {
      ipcRenderer.removeListener(IPC.libraryEnrichProgress, handler);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);
