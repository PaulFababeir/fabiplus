import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC, type RendererApi } from '../shared/ipc.js';
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
} from '../shared/types.js';

/**
 * The renderer gets exactly this surface and nothing else — no `fs`, no raw
 * `ipcRenderer`. Every path that reaches the disk is validated in main.
 */
const api: RendererApi = {
  getConfig: () => ipcRenderer.invoke(IPC.configGet) as Promise<AppConfig>,
  setTmdbKey: (key) => ipcRenderer.invoke(IPC.configSetTmdbKey, key) as Promise<AppConfig>,
  setLastProfile: (id) => ipcRenderer.invoke(IPC.configSetLastProfile, id) as Promise<AppConfig>,
  setTranslucent: (enabled) =>
    ipcRenderer.invoke(IPC.configSetTranslucent, enabled) as Promise<AppConfig>,
  setVideoBrightness: (value) =>
    ipcRenderer.invoke(IPC.configSetVideoBrightness, value) as Promise<AppConfig>,

  getLibrary: () => ipcRenderer.invoke(IPC.libraryGet) as Promise<LibraryCatalog>,
  scanLibrary: () => ipcRenderer.invoke(IPC.libraryScan) as Promise<LibraryCatalog>,
  enrichLibrary: (force) =>
    ipcRenderer.invoke(IPC.libraryEnrich, force) as Promise<EnrichmentSummary>,
  fetchNewLibrary: () => ipcRenderer.invoke(IPC.libraryFetchNew) as Promise<EnrichmentSummary>,
  rematch: (movieId, remoteId) =>
    ipcRenderer.invoke(IPC.libraryRematch, movieId, remoteId) as Promise<LibraryCatalog>,
  searchProvider: (query, year) =>
    ipcRenderer.invoke(IPC.librarySearchProvider, query, year) as Promise<ReviewCandidate[]>,
  loadSubtitle: (path) => ipcRenderer.invoke(IPC.subtitleLoad, path) as Promise<string | null>,
  probeVideoColour: (path) =>
    ipcRenderer.invoke(IPC.videoColour, path) as Promise<VideoColourInfo>,

  getAppVersion: () => ipcRenderer.invoke(IPC.appVersion) as Promise<string>,
  setDiscordActivity: (activity) =>
    ipcRenderer.invoke(IPC.discordSet, activity) as Promise<boolean>,
  setDiscordConfig: (enabled, appId) =>
    ipcRenderer.invoke(IPC.configSetDiscord, enabled, appId) as Promise<AppConfig>,
  checkForUpdate: () => ipcRenderer.invoke(IPC.updateCheck) as Promise<UpdateStatus>,
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload) as Promise<UpdateStatus>,

  onEnrichProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: EnrichmentProgress): void =>
      listener(progress);
    ipcRenderer.on(IPC.libraryEnrichProgress, handler);
    return () => {
      ipcRenderer.removeListener(IPC.libraryEnrichProgress, handler);
    };
  },

  listProfiles: () => ipcRenderer.invoke(IPC.profilesList) as Promise<Profile[]>,
  createProfile: (name) => ipcRenderer.invoke(IPC.profileCreate, name) as Promise<Profile[]>,
  deleteProfile: (id) => ipcRenderer.invoke(IPC.profileDelete, id) as Promise<Profile[]>,
  renameProfile: (id, name) =>
    ipcRenderer.invoke(IPC.profileRename, id, name) as Promise<Profile[]>,
  getProfileState: (id) => ipcRenderer.invoke(IPC.profileStateGet, id) as Promise<ProfileState>,

  setWatchProgress: (profileId, movieId, positionSec, durationSec) =>
    ipcRenderer.invoke(
      IPC.watchSet,
      profileId,
      movieId,
      positionSec,
      durationSec
    ) as Promise<ProfileState>,
  clearWatchProgress: (profileId, movieId) =>
    ipcRenderer.invoke(IPC.watchClear, profileId, movieId) as Promise<ProfileState>,
  setPosterChoice: (profileId, movieId, index) =>
    ipcRenderer.invoke(IPC.posterChoiceSet, profileId, movieId, index) as Promise<ProfileState>
};

contextBridge.exposeInMainWorld('api', api);
