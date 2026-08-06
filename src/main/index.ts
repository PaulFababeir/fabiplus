import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';

import { DISCORD_APP_ID } from '@shared/constants';
import { IPC } from '@shared/ipc';
import { isVtt, srtToVtt } from '@shared/subtitles';
import type {
  AppConfig,
  DiscordActivity,
  EnrichmentSummary,
  LibraryCatalog,
  Profile,
  ProfileState,
  ReviewCandidate,
  SubtitleFile,
  UpdateStatus,
  VideoColourInfo
} from '@shared/types';
import { imageCacheDir, loadConfig, saveConfig } from './services/config.js';
import { isInside } from './services/path-containment.js';
import { serveFile } from './services/media-server.js';
import { isHdrTagged, probeVideoColour } from './services/video-colour.js';
import { checkForUpdate, currentVersion, downloadUpdate } from './services/updater.js';
import { presence } from './services/discord-presence.js';
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
import { rescanSubtitles, scanRoots } from './services/scanner.js';

const isDev = !app.isPackaged;

/**
 * Pins the data directory to a literal name, independent of the display name.
 *
 * Electron derives `userData` from `app.getName()`, which returns `productName`
 * when set. Renaming the app would therefore move `%APPDATA%/movie-app` and
 * orphan the catalog, profiles and image cache in a single release — and watch
 * history is not regenerable. Fixing the path here is what lets `productName`
 * be a display name rather than a load-bearing identifier.
 *
 * It also closes a dev/production split: unpackaged runs took the name from
 * package.json (`movie-app`) while packaged ones took `build.productName`, so
 * the two used different directories the moment those differed.
 *
 * Must run before anything reads a userData path.
 */
app.setPath('userData', join(app.getPath('appData'), 'movie-app'));

/**
 * Chromium colour-manages video into the display's ICC profile; VLC and most
 * desktop players do not. On a wide-gamut or non-sRGB monitor that transform
 * is what makes the same file look noticeably darker here than in VLC.
 * Pinning the target to sRGB skips it, so playback matches.
 *
 * Must run before `app.whenReady`.
 */
app.commandLine.appendSwitch('force-color-profile', 'srgb');

/**
 * Local files are served through a custom scheme rather than file:// so the
 * renderer can stay sandboxed and every request passes the containment check
 * in `resolveAllowedPath`. `stream: true` is what lets the player seek.
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

  ipcMain.handle(IPC.configSetMovieRoots, async (_event, roots: unknown): Promise<AppConfig> => {
    const config = await loadConfig();
    const next = Array.isArray(roots)
      ? [...new Set(roots.filter((r): r is string => typeof r === 'string' && r.trim() !== ''))]
      : [];
    return saveConfig({ ...config, movieRoots: next });
  });

  ipcMain.handle(IPC.configPickFolder, async (): Promise<string | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });

    // Cancelling is a normal outcome, not an error — the caller keeps its roots.
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC.configSetTranslucent, async (_event, on: unknown): Promise<AppConfig> => {
    const config = await loadConfig();
    const enabled = on === true;
    for (const win of BrowserWindow.getAllWindows()) applyBackdrop(win, enabled);
    return saveConfig({ ...config, translucentBackground: enabled });
  });

  ipcMain.handle(
    IPC.configSetVideoBrightness,
    async (_event, value: unknown): Promise<AppConfig> => {
      const config = await loadConfig();
      // Clamped so a bad value cannot render playback unwatchable.
      const next = typeof value === 'number' && Number.isFinite(value)
        ? Math.min(2, Math.max(0.5, value))
        : 1;
      return saveConfig({ ...config, videoBrightness: next });
    }
  );

  ipcMain.handle(IPC.libraryGet, async (): Promise<LibraryCatalog> => loadLibraryForDisplay());

  ipcMain.handle(IPC.libraryScan, async (): Promise<LibraryCatalog> => {
    const config = await loadConfig();
    // Throws if library.json exists but is unreadable, rather than treating
    // it as empty and overwriting an enriched catalog with a bare scan.
    const existing = await loadLibrary();
    const scan = await scanRoots(config.movieRoots, 'movie');
    const merged = mergeScan(existing, scan, config.movieRoots);

    if (wouldDestroyMetadata(existing, merged, config.movieRoots)) {
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

  ipcMain.handle(IPC.libraryFetchNew, async (event): Promise<EnrichmentSummary> => {
    const config = await loadConfig();
    const empty: EnrichmentSummary = {
      total: 0,
      matched: 0,
      needsReview: 0,
      failed: 0,
      durationMs: 0,
      review: [],
      fatalError: null
    };

    if (!config.tmdbApiKey) {
      return { ...empty, fatalError: 'No TMDB API key set. Add one in Settings.' };
    }

    const existing = await loadLibrary();
    // Captured before the merge — afterwards every item looks equally present.
    const knownIds = new Set(existing.items.map((item) => item.id));

    const scan = await scanRoots(config.movieRoots, 'movie');
    const merged = mergeScan(existing, scan, config.movieRoots);
    if (wouldDestroyMetadata(existing, merged, config.movieRoots)) {
      console.error('[library] rescan would drop all metadata; keeping the stored catalog');
      return { ...empty, fatalError: 'Rescan looked wrong and was refused. Nothing was changed.' };
    }
    await saveLibrary(merged);

    const fresh = merged.items.filter((item) => !knownIds.has(item.id));
    if (fresh.length === 0) return empty;

    const provider = new TmdbProvider(config.tmdbApiKey);
    const { items: enriched, summary } = await enrichLibrary(fresh, provider, {
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.libraryEnrichProgress, progress);
      }
    });

    // Fold the enriched newcomers back into the full catalog.
    const byId = new Map(enriched.map((item) => [item.id, item]));
    const next = merged.items.map((item) => byId.get(item.id) ?? item);

    await saveLibrary({ ...merged, items: next });
    await backupLibrary();
    console.log(`[library] fetched metadata for ${fresh.length} new film(s)`);
    return summary;
  });

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

  ipcMain.handle(IPC.subtitleRescan, async (_event, folderPath: unknown): Promise<SubtitleFile[]> => {
    if (typeof folderPath !== 'string') return [];

    // A folder path from the renderer is no more trustworthy than a file path.
    const safe = await resolveAllowedPath(folderPath);
    if (!safe) return [];

    return rescanSubtitles(safe);
  });

  ipcMain.handle(IPC.videoColour, async (_event, path: unknown): Promise<VideoColourInfo> => {
    if (typeof path !== 'string') return { transfer: null, hdr: false };

    const safe = await resolveAllowedPath(path);
    if (!safe) return { transfer: null, hdr: false };

    const colour = await probeVideoColour(safe);
    return { transfer: colour.transfer, hdr: isHdrTagged(colour) };
  });

  ipcMain.handle(IPC.appVersion, async (): Promise<string> => currentVersion());
  ipcMain.handle(IPC.updateCheck, async (): Promise<UpdateStatus> => checkForUpdate());
  ipcMain.handle(IPC.updateDownload, async (): Promise<UpdateStatus> => downloadUpdate());

  ipcMain.handle(IPC.discordSet, async (_event, activity: unknown): Promise<string | null> => {
    const config = await loadConfig();
    if (!config.discordPresence) {
      presence.disconnect();
      return null;
    }

    // A stored override stays honoured so an existing install keeps whatever it
    // was pointed at; everyone else gets the bundled application.
    const appId = config.discordAppId ?? DISCORD_APP_ID;

    // Silent failure here means Discord is not running, which is normal and not
    // worth surfacing to the user — but it should still be findable in a log.
    if (!(await presence.connect(appId))) {
      console.warn('[discord] could not reach the Discord client');
      return null;
    }

    presence.set((activity ?? null) as DiscordActivity | null);
    return presence.appName;
  });

  ipcMain.handle(
    IPC.configSetDiscord,
    async (_event, enabled: unknown, appId: unknown): Promise<AppConfig> => {
      const config = await loadConfig();
      const on = enabled === true;
      const id = typeof appId === 'string' && appId.trim() !== '' ? appId.trim() : null;

      // Turning it off must clear whatever is currently on the profile.
      if (!on || !id) {
        presence.set(null);
        presence.disconnect();
      }
      return saveConfig({ ...config, discordPresence: on, discordAppId: id });
    }
  );

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

/**
 * Windows 11 acrylic. The window's own background must be fully transparent
 * for the material to show at all — an opaque colour paints straight over it.
 * Falls back silently on anything that does not support the material.
 */
function applyBackdrop(win: BrowserWindow, enabled: boolean): void {
  try {
    win.setBackgroundColor(enabled ? '#00000000' : '#0e0f11');
    win.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
  } catch {
    // Older Windows, or a platform without the API — solid background stands.
  }
}

async function createWindow(): Promise<void> {
  const config = await loadConfig();
  const translucent = config.translucentBackground;
  const win = new BrowserWindow({
    width: 1540,
    height: 1024,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: translucent ? '#00000000' : '#0e0f11',
    backgroundMaterial: translucent ? 'acrylic' : 'none',
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
 * Refuses renderer-initiated windows and navigation.
 *
 * A window opened from the renderer inherits this preload, and with it the
 * whole `window.api` surface — file reads, config writes, the catalog.
 * Navigation is the same hole from the other direction: the CSP governs what a
 * document may *load*, not where the top-level frame may *go*, so without this
 * one injected link could replace the app with a remote page holding those
 * privileges.
 *
 * A flat deny is right rather than an allowlist because the UI has no external
 * links and never opens a second window — the only legitimate navigation is the
 * dev server reloading itself.
 *
 * Registered per-contents at the app level so any window added later is covered
 * without having to remember this.
 */
function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      if (isDev && devUrl && url.startsWith(devUrl)) return;
      event.preventDefault();
    });

    // No <webview> is used; deny rather than leave the door ajar.
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
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
    hardenWebContents();
    registerMovieProtocol();
    registerIpc();
    void createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
