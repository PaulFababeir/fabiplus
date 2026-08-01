import { app, BrowserWindow, ipcMain, net, protocol } from 'electron';
import { realpath } from 'node:fs/promises';
import { join, resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { IPC } from '@shared/ipc';
import type { AppConfig, ScanResult } from '@shared/types';
import { imageCacheDir, loadConfig, saveConfig } from './services/config.js';
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
    return net.fetch(pathToFileURL(safe).toString());
  });
}

function registerIpc(): void {
  ipcMain.handle(IPC.configGet, async (): Promise<AppConfig> => loadConfig());

  ipcMain.handle(IPC.configSetTmdbKey, async (_event, key: unknown): Promise<AppConfig> => {
    const config = await loadConfig();
    const value = typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
    return saveConfig({ ...config, tmdbApiKey: value });
  });

  ipcMain.handle(IPC.libraryScan, async (): Promise<ScanResult> => {
    const config = await loadConfig();
    return scanRoots(config.movieRoots, 'movie');
  });
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
    titleBarOverlay: { color: '#0e0f11', symbolColor: '#e8e8ea', height: 40 },
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

void app.whenReady().then(() => {
  registerMovieProtocol();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
