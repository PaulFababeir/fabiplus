import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LibraryCatalog } from '@shared/types';
import { readJsonOrFail, writeJsonAtomic } from './atomic-json.js';
import { libraryPath, userDataDir } from './config.js';
// Re-exported so callers keep importing catalog handling from one place.
export { mergeScan, wouldDestroyMetadata } from './library-merge.js';

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

export async function saveLibrary(catalog: LibraryCatalog): Promise<void> {
  await writeJsonAtomic(libraryPath(), catalog);
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
