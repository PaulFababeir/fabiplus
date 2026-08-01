import { contextBridge, ipcRenderer } from 'electron';

import { IPC, type RendererApi } from '../shared/ipc.js';
import type { AppConfig, ScanResult } from '../shared/types.js';

/**
 * The renderer gets exactly these three calls and nothing else — no `fs`, no
 * `ipcRenderer`. Every path that reaches the disk is validated in main.
 */
const api: RendererApi = {
  getConfig: () => ipcRenderer.invoke(IPC.configGet) as Promise<AppConfig>,
  setTmdbKey: (key) => ipcRenderer.invoke(IPC.configSetTmdbKey, key) as Promise<AppConfig>,
  scanLibrary: () => ipcRenderer.invoke(IPC.libraryScan) as Promise<ScanResult>
};

contextBridge.exposeInMainWorld('api', api);
