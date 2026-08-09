import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LibraryCatalog } from '@shared/types';
import { readJsonOrFail, writeJsonAtomic } from './atomic-json.js';
import { libraryPath, userDataDir } from './config.js';
// Re-exported so callers keep importing catalog handling from one place.
export { mergeScan, withSubtitles, wouldDestroyMetadata } from './library-merge.js';

const SCHEMA_VERSION = 1;

/**
 * Kept alongside the catalog. Enrichment costs ~160 API calls, so a lost
 * catalog should be recoverable from disk rather than refetched.
 */
export function libraryBackupPath(): string {
  return join(userDataDir(), 'library.backup.json');
}

function emptyCatalog(): LibraryCatalog {
  return { schemaVersion: SCHEMA_VERSION, scannedAt: new Date().toISOString(), roots: [], items: [] };
}

function isUsable(catalog: LibraryCatalog | null): catalog is LibraryCatalog {
  return (
    catalog !== null && catalog.schemaVersion === SCHEMA_VERSION && Array.isArray(catalog.items)
  );
}

/**
 * Throws when the file exists but cannot be read. Callers that write back
 * MUST NOT treat a read failure as "empty library" — that path silently
 * replaces an enriched catalog with a bare scan.
 */
export async function loadLibrary(): Promise<LibraryCatalog> {
  const loaded = await readJsonOrFail<LibraryCatalog | null>(libraryPath(), null);
  if (loaded === null) return emptyCatalog();

  if (!isUsable(loaded)) {
    throw new Error(
      `library.json is present but unusable (schemaVersion=${String(
        (loaded as Partial<LibraryCatalog>).schemaVersion
      )}). Refusing to overwrite it.`
    );
  }
  return loaded;
}

/** Read-only variant for display paths that should degrade rather than throw. */
export async function loadLibraryForDisplay(): Promise<LibraryCatalog> {
  try {
    return await loadLibrary();
  } catch {
    return emptyCatalog();
  }
}

/**
 * Writes the catalog, then reads it back and checks it stuck.
 *
 * The read-back is not paranoia about `writeJsonAtomic`. A catalog has been
 * observed reverting to its previous contents *after* a successful enrichment
 * — `library.backup.json` held 87 enriched films while `library.json` still
 * held the 79 it had beforehand — with nothing in this app able to explain it.
 * Whatever is doing that, the failure was silent: the run reported success and
 * the work was gone.
 *
 * This cannot prevent a revert that happens later, but it turns "the catalog
 * quietly went backwards" into an error the caller can surface, which is the
 * difference between a mystery and a bug report.
 */
export async function saveLibrary(catalog: LibraryCatalog): Promise<void> {
  await writeJsonAtomic(libraryPath(), catalog);

  const readBack = await readJsonOrFail<LibraryCatalog | null>(libraryPath(), null);
  if (readBack === null || readBack.items.length !== catalog.items.length) {
    throw new Error(
      `library.json did not keep what was written: expected ${catalog.items.length} items, ` +
        `found ${readBack === null ? 'no file' : String(readBack.items.length)}. ` +
        'Something outside the app is rewriting it.'
    );
  }
}

/**
 * Snapshots the catalog once it holds metadata worth protecting. Called after
 * enrichment, so a later mishap costs a file copy rather than a refetch.
 */
export async function backupLibrary(): Promise<void> {
  try {
    await copyFile(libraryPath(), libraryBackupPath());
  } catch {
    // A missing backup is not worth failing enrichment over.
  }
}
