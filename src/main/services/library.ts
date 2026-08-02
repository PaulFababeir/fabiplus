import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LibraryCatalog, LibraryItem, ScanResult } from '@shared/types';
import { readJsonOrFail, writeJsonAtomic } from './atomic-json.js';
import { libraryPath, userDataDir } from './config.js';

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

/**
 * Folds a fresh disk scan into the stored catalog.
 *
 * Scanning is the authority on what exists and where; the stored catalog is
 * the authority on metadata. Films still present keep their metadata and match
 * so a rescan never triggers a full re-download, while renamed or deleted
 * folders drop out.
 */
export function mergeScan(
  existing: LibraryCatalog,
  scan: ScanResult,
  roots: string[]
): LibraryCatalog {
  const previous = new Map(existing.items.map((item) => [item.id, item]));

  const items: LibraryItem[] = scan.items.map((scanned) => {
    const prior = previous.get(scanned.id);
    if (!prior) return scanned;

    return {
      ...scanned,
      // Preserve the original discovery date rather than resetting it on
      // every rescan — "recently added" depends on it.
      addedAt: prior.addedAt,
      metadata: prior.metadata,
      match: prior.match
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    scannedAt: new Date().toISOString(),
    roots,
    items
  };
}

/**
 * Guards against a rescan wiping enrichment. If the stored catalog had
 * metadata and the merged result has none, something is wrong with the merge
 * (renamed roots, changed id scheme) and the write should be refused.
 */
export function wouldDestroyMetadata(
  existing: LibraryCatalog,
  merged: LibraryCatalog
): boolean {
  const had = existing.items.filter((i) => i.metadata !== null).length;
  const keeps = merged.items.filter((i) => i.metadata !== null).length;
  return had > 0 && keeps === 0;
}
