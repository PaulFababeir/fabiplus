import type { LibraryCatalog, LibraryItem, ScanResult } from '@shared/types';
import { readJsonSafe, writeJsonAtomic } from './atomic-json.js';
import { libraryPath } from './config.js';

const SCHEMA_VERSION = 1;

function emptyCatalog(): LibraryCatalog {
  return { schemaVersion: SCHEMA_VERSION, scannedAt: new Date().toISOString(), roots: [], items: [] };
}

export async function loadLibrary(): Promise<LibraryCatalog> {
  const loaded = await readJsonSafe<LibraryCatalog | null>(libraryPath(), null);
  if (!loaded || loaded.schemaVersion !== SCHEMA_VERSION || !Array.isArray(loaded.items)) {
    return emptyCatalog();
  }
  return loaded;
}

export async function saveLibrary(catalog: LibraryCatalog): Promise<void> {
  await writeJsonAtomic(libraryPath(), catalog);
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
