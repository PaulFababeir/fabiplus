import { app } from 'electron';
import electronUpdater from 'electron-updater';

import type { UpdateStatus } from '@shared/types';

/**
 * Manual update checks.
 *
 * Deliberately not automatic. Everything else in this app works with the
 * network off, and a background updater phoning home at every launch would
 * quietly break that promise. The user asks; nothing happens otherwise.
 *
 * Windows will not let a running process overwrite its own executable, so the
 * installer is downloaded to a temp directory and applied on quit.
 */

const { autoUpdater } = electronUpdater;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

/** Packaged builds only — in dev there is no update feed to talk to. */
function unavailable(reason: string): UpdateStatus {
  return { state: 'unavailable', version: app.getVersion(), detail: reason };
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return unavailable('Update checks only run in an installed build.');
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const next = result?.updateInfo.version;

    if (!next || next === app.getVersion()) {
      return { state: 'current', version: app.getVersion(), detail: null };
    }
    return { state: 'available', version: app.getVersion(), detail: next };
  } catch (err) {
    return {
      state: 'error',
      version: app.getVersion(),
      detail: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Downloads the pending update. It installs when the app next quits — the
 * running executable cannot be replaced in place.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) return unavailable('Not an installed build.');

  try {
    await autoUpdater.downloadUpdate();
    return { state: 'downloaded', version: app.getVersion(), detail: null };
  } catch (err) {
    return {
      state: 'error',
      version: app.getVersion(),
      detail: err instanceof Error ? err.message : String(err)
    };
  }
}

export function currentVersion(): string {
  return app.getVersion();
}
