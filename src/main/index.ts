import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve as resolvePath, sep } from 'node:path';

import { IPC } from '@shared/ipc';
import { isVtt, srtToVtt } from '@shared/subtitles';
import type {
  AppConfig,
  EnrichmentSummary,
  LibraryCatalog,
  Profile,
  ProfileState,
  ReviewCandidate
} from '@shared/types';
import { imageCacheDir, loadConfig, saveConfig } from './services/config.js';
import { serveFile } from './services/media-server.js';
import { applyManualMatch, enrichLibrary } from './services/enrichment.js';
import {
  backupLibrary,
  loadLibrary,
  loadLibraryForDisplay,
  mergeScan,
  saveLibrary,
  wouldDestroyMetadata
} from './services/library.js';
import { rankCandidates } from './services/metadata/matcher.js';
import { TmdbProvider } from './services/metadata/tmdb.js';
import {
  clearWatchProgress,
  createProfile,
  deleteProfile,
  ensureProfile,
  loadProfiles,
  loadProfileState,
  renameProfile,
  setPosterChoice,
  setWatchProgress
} from './services/profiles.js';
import { scanRoots } from './services/scanner.js';

const isDev = !app.isPackaged;

/**
 * Local files are served through a custom scheme rather than file:// so the
 * renderer can stay sandboxed and every request passes the containment check
 * in `resolveAllowedPath`. `stream: true` is what makes video seeking work
 * once the player lands in Phase 2.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'movie',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

/** Directories the renderer is allowed to read through movie://. */
async function allowedRoots(): Promise<string[]> {
  const config = await loadConfig();
  return [...config.movieRoots, ...config.seriesRoots, imageCacheDir()].map((p) => resolvePath(p));
}

function isInside(child: string, parent: string): boolean {
  // Windows paths are case-insensitive; compare in a single case.
  const a = child.toLowerCase();
  const b = parent.toLowerCase();
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * Rejects anything outside a configured library root or the image cache.
 * Resolves symlinks first so a link inside the library cannot point out of it.
 */
async function resolveAllowedPath(requested: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(resolvePath(requested));
  } catch {
    return null;
  }

  const roots = await allowedRoots();
  return roots.some((root) => isInside(real, root)) ? real : null;
}

function registerMovieProtocol(): void {
  protocol.handle('movie', async (request) => {
    const url = new URL(request.url);
    const requested = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!requested) return new Response('Bad request', { status: 400 });

    const safe = await resolveAllowedPath(requested);
    if (!safe) {
      return new Response('Forbidden', { status: 403 });
    }

    // Served by hand rather than via net.fetch(file://) so Range headers are
    // honoured — without 206 responses the video element cannot seek.
    return serveFile(safe, request.headers.get('Range'));
  });
}

function registerIpc(): void {
  ipcMain.handle(IPC.configGet, async (): Promise<AppConfig> => loadConfig());

  ipcMain.handle(IPC.configSetTmdbKey, async (_event, key: unknown): Promise<AppConfig> => {
    const config = await loadConfig();
    const value = typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
    return saveConfig({ ...config, tmdbApiKey: value });
  });

  ipcMain.handle(IPC.configSetLastProfile, async (_event, id: unknown): Promise<AppConfig> => {
    const config = await loadConfig();
    return saveConfig({ ...config, lastProfileId: typeof id === 'string' ? id : null });
  });

  ipcMain.handle(IPC.libraryGet, async (): Promise<LibraryCatalog> => loadLibraryForDisplay());

  ipcMain.handle(IPC.libraryScan, async (): Promise<LibraryCatalog> => {
    const config = await loadConfig();
    // Throws if library.json exists but is unreadable, rather than treating
    // it as empty and overwriting an enriched catalog with a bare scan.
    const existing = await loadLibrary();
    const scan = await scanRoots(config.movieRoots, 'movie');
    const merged = mergeScan(existing, scan, config.movieRoots);

    if (wouldDestroyMetadata(existing, merged)) {
      console.error('[library] rescan would drop all metadata; keeping the stored catalog');
      return existing;
    }

    await saveLibrary(merged);
    return merged;
  });

  ipcMain.handle(
    IPC.libraryEnrich,
    async (event, force: unknown): Promise<EnrichmentSummary> => {
      const config = await loadConfig();
      if (!config.tmdbApiKey) {
        return {
          total: 0,
          matched: 0,
          needsReview: 0,
          failed: 0,
          durationMs: 0,
          review: [],
          fatalError: 'No TMDB API key set. Add one in Settings.'
        };
      }

      const catalog = await loadLibrary();
      const provider = new TmdbProvider(config.tmdbApiKey);

      const { items, summary } = await enrichLibrary(catalog.items, provider, {
        force: force === true,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC.libraryEnrichProgress, progress);
          }
        }
      });

      // A failed save silently discards a whole enrichment run, so surface it
      // rather than returning a summary that claims success.
      try {
        await saveLibrary({ ...catalog, items });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[library] failed to save catalog after enrichment:', detail);
        return { ...summary, fatalError: `Metadata was fetched but could not be saved: ${detail}` };
      }

      const enriched = items.filter((i) => i.metadata).length;
      await backupLibrary();
      console.log(`[library] saved ${enriched}/${items.length} enriched items (backup written)`);
      return summary;
    }
  );

  ipcMain.handle(
    IPC.libraryRematch,
    async (_event, movieId: unknown, remoteId: unknown): Promise<LibraryCatalog> => {
      const config = await loadConfig();
      const catalog = await loadLibrary();
      if (!config.tmdbApiKey || typeof movieId !== 'string' || typeof remoteId !== 'number') {
        return catalog;
      }

      const target = catalog.items.find((item) => item.id === movieId);
      if (!target) return catalog;

      const provider = new TmdbProvider(config.tmdbApiKey);
      const updated = await applyManualMatch(target, provider, remoteId);
      const next: LibraryCatalog = {
        ...catalog,
        items: catalog.items.map((item) => (item.id === movieId ? updated : item))
      };

      await saveLibrary(next);
      return next;
    }
  );

  ipcMain.handle(
    IPC.librarySearchProvider,
    async (_event, query: unknown, year: unknown): Promise<ReviewCandidate[]> => {
      const config = await loadConfig();
      if (!config.tmdbApiKey || typeof query !== 'string' || query.trim() === '') return [];

      const parsedYear = typeof year === 'number' ? year : null;
      const provider = new TmdbProvider(config.tmdbApiKey);
      const candidates = await provider.search(query.trim(), parsedYear);

      return rankCandidates(query.trim(), parsedYear, candidates)
        .slice(0, 8)
        .map((scored) => ({
          remoteId: scored.candidate.id,
          title: scored.candidate.title,
          year: scored.candidate.year,
          score: scored.score,
          posterUrl: scored.candidate.posterPath
            ? provider.imageUrl(scored.candidate.posterPath, 'thumb')
            : null,
          overview: scored.candidate.overview ?? ''
        }));
    }
  );

  ipcMain.handle(IPC.subtitleLoad, async (_event, path: unknown): Promise<string | null> => {
    if (typeof path !== 'string') return null;

    // Same containment check as the media protocol — a subtitle path arriving
    // from the renderer is no more trustworthy than any other.
    const safe = await resolveAllowedPath(path);
    if (!safe) return null;

    try {
      const raw = await readFile(safe, 'utf8');
      return isVtt(raw) ? raw : srtToVtt(raw);
    } catch {
      return null;
    }
  });

  // -- Profiles ------------------------------------------------------------

  ipcMain.handle(IPC.profilesList, async (): Promise<Profile[]> => ensureProfile());

  ipcMain.handle(IPC.profileCreate, async (_event, name: unknown): Promise<Profile[]> => {
    await createProfile(typeof name === 'string' ? name : '');
    return loadProfiles();
  });

  ipcMain.handle(IPC.profileDelete, async (_event, id: unknown): Promise<Profile[]> => {
    if (typeof id !== 'string') return loadProfiles();
    await deleteProfile(id);
    // Never leave the app with zero profiles to switch to.
    return ensureProfile();
  });

  ipcMain.handle(
    IPC.profileRename,
    async (_event, id: unknown, name: unknown): Promise<Profile[]> => {
      if (typeof id !== 'string' || typeof name !== 'string') return loadProfiles();
      return renameProfile(id, name);
    }
  );

  ipcMain.handle(IPC.profileStateGet, async (_event, id: unknown): Promise<ProfileState> => {
    return loadProfileState(String(id));
  });

  // -- Watch state ---------------------------------------------------------

  ipcMain.handle(
    IPC.watchSet,
    async (
      _event,
      profileId: unknown,
      movieId: unknown,
      positionSec: unknown,
      durationSec: unknown
    ): Promise<ProfileState> =>
      setWatchProgress(String(profileId), String(movieId), Number(positionSec), Number(durationSec))
  );

  ipcMain.handle(
    IPC.watchClear,
    async (_event, profileId: unknown, movieId: unknown): Promise<ProfileState> =>
      clearWatchProgress(String(profileId), String(movieId))
  );

  ipcMain.handle(
    IPC.posterChoiceSet,
    async (_event, profileId: unknown, movieId: unknown, index: unknown): Promise<ProfileState> =>
      setPosterChoice(String(profileId), String(movieId), Number(index))
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1540,
    height: 1024,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0e0f11',
    // The design has no OS title bar; keep the native window controls only.
    titleBarStyle: 'hidden',
    /*
     * A fully transparent overlay lets the window buttons sit directly on
     * whatever is behind them, so they blend into the sidebar backdrop instead
     * of being boxed in by a painted rectangle. Height must match
     * --titlebar-strip in tokens.css.
     */
    titleBarOverlay: { color: '#00000000', symbolColor: '#e8e8ea', height: 38 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

/**
 * All state lives in plain JSON files with no locking, so a second instance
 * would race the first and silently clobber it — that is how a profile ends
 * up orphaned. Refuse to start twice; focus the existing window instead.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  void app.whenReady().then(() => {
    registerMovieProtocol();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
