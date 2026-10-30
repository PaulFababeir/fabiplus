#!/usr/bin/env node
/**
 * Makes sure the Electron binary is on disk before anything tries to run it.
 * Wired in as `predev` and `prestart`, so it runs ahead of both on its own.
 *
 * Electron 43.8 dropped its install script. The binary and `path.txt` now
 * appear only when something first calls `require('electron')`, which
 * downloads them on demand. electron-vite never does: it reads
 * `node_modules/electron/path.txt` itself and throws "Electron uninstall" when
 * the file is missing. So any fresh install — `npm ci`, a new clone, the
 * `npm audit fix` that took Electron from 43.2 to 43.8 — left `npm run dev`
 * unable to start, with an error that names neither cause.
 *
 * Requiring the package here is the whole fix: it runs Electron's own
 * downloader when the binary is absent and returns at once when it is present.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  require('electron');
} catch (err) {
  console.error(
    '\nElectron could not be downloaded, so the app cannot start.\n' +
      'Check the network, then delete node_modules/electron and run npm install.\n'
  );
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
