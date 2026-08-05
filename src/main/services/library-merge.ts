import type { LibraryCatalog, LibraryItem, ScanResult } from '@shared/types';

/**
 * The pure half of catalog handling: folding a scan into the stored catalog,
 * and the guard that decides whether the result is safe to write.
 *
 * Split out from `library.ts` because that module reaches `config.ts` for the
 * file paths, which imports `electron` — nothing importing it can be loaded by
 * a test. This is the code that can destroy a user's enriched catalog, so it
 * needs to be reachable without an Electron runtime.
 */

export const LIBRARY_SCHEMA_VERSION = 1;

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
    schemaVersion: LIBRARY_SCHEMA_VERSION,
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
  merged: LibraryCatalog,
  roots: string[]
): boolean {
  // Removing the last folder is a deliberate act, not a failed merge. Without
  // this the catalog would refuse to empty and the films would stay on screen
  // after the user removed the only root they had.
  if (roots.length === 0) return false;

  const had = existing.items.filter((i) => i.metadata !== null).length;
  const keeps = merged.items.filter((i) => i.metadata !== null).length;
  return had > 0 && keeps === 0;
}
