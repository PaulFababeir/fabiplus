import type { LibraryCatalog, LibraryItem, ScanResult, Season, SubtitleFile } from '@shared/types';

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
 * Carries provider-supplied episode data across a rescan.
 *
 * The same split as the item level, one layer down: the scan owns the files —
 * which episodes exist, their paths, their subtitles — and the stored catalog
 * owns everything the provider filled in. Without this, `seasons` came straight
 * off the scan and every episode runtime, recovered title and still was
 * silently discarded the next time the library was scanned, with no way to get
 * them back short of a full refetch.
 *
 * Episodes are matched by id, which is a hash of the file path, so a moved or
 * renamed file correctly loses its enrichment rather than inheriting a
 * stranger's.
 */
function mergeSeasons(scanned: Season[] | null, prior: Season[] | null): Season[] | null {
  if (scanned === null || prior === null) return scanned;

  const before = new Map(prior.flatMap((season) => season.episodes).map((e) => [e.id, e]));

  return scanned.map((season) => ({
    ...season,
    episodes: season.episodes.map((episode) => {
      const known = before.get(episode.id);
      if (!known) return episode;

      return {
        ...episode,
        // A title read from the filename still wins, matching the rule
        // enrichment itself applies; the stored one is the provider's.
        title: episode.title ?? known.title,
        runtimeMin: episode.runtimeMin ?? known.runtimeMin,
        // `?? null` because a catalog written before stills existed has no such
        // key at all, and `undefined` is not what the type promises.
        still: known.still ?? null
      };
    })
  }));
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
      seasons: mergeSeasons(scanned.seasons, prior.seasons),
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
 * Records the full-size copy of one backdrop against an item.
 *
 * Only the default backdrop is fetched large at enrichment; the rest are picker
 * previews until one is chosen. This is the patch that records the upgrade, and
 * it lives here rather than in `enrichment.ts` for the usual reason — that
 * module reaches the image cache, which reaches `config.ts`, which imports
 * `electron`, so no test can load it.
 *
 * Returns the same item when there is nothing to record, which is what lets the
 * caller skip a catalog write.
 */
export function withBackdropFull(
  item: LibraryItem,
  index: number,
  fullPath: string
): LibraryItem {
  const backdrops = item.metadata?.backdrops ?? [];
  const target = backdrops[index];
  if (!item.metadata || !target || target.fullPath) return item;

  const next = backdrops.map((b, i) => (i === index ? { ...b, fullPath } : b));

  return {
    ...item,
    metadata: {
      ...item.metadata,
      backdrops: next,
      /*
       * The legacy scalar is `backdrops[0]` by definition, so upgrading index
       * zero has to move both or `backdropFor` would read the full size from
       * the list while a catalog written before the list existed kept serving
       * the preview from the scalar.
       */
      backdrop: index === 0 ? (next[0] ?? item.metadata.backdrop) : item.metadata.backdrop
    }
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

/**
 * Records a fresh subtitle list against whatever lives at `folderPath`.
 *
 * The rescan used to exist only in the player's state, so the tracks vanished
 * the moment you left the film and had to be found again on every visit. The
 * folder is the key because that is all the player knows: for a film it is the
 * item's own folder, for an episode the season folder it sits in.
 *
 * Returns the same catalog object when nothing matched, so a caller can skip
 * the write.
 */
export function withSubtitles(
  catalog: LibraryCatalog,
  folderPath: string,
  subtitles: SubtitleFile[]
): { catalog: LibraryCatalog; changed: boolean } {
  const key = folderPath.toLowerCase();
  let changed = false;

  const items = catalog.items.map((item) => {
    if (item.folderPath.toLowerCase() === key) {
      changed = true;
      return { ...item, subtitles };
    }

    if (item.seasons === null) return item;

    let touched = false;
    const seasons = item.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => {
        if (episode.folderPath.toLowerCase() !== key) return episode;
        touched = true;
        // Every episode in the folder shares the sweep, so keep only the files
        // whose name matches this one rather than handing it the whole season.
        const stem = episode.video.path.replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase();
        const mine = subtitles.filter((f) => f.path.toLowerCase().startsWith(stem));
        return { ...episode, subtitles: mine.length > 0 ? mine : episode.subtitles };
      })
    }));

    if (!touched) return item;
    changed = true;
    return { ...item, seasons };
  });

  return { catalog: changed ? { ...catalog, items } : catalog, changed };
}
