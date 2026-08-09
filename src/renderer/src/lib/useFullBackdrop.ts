import { useEffect } from 'react';

import type { LibraryItem, ProfileState } from '@shared/types';
import { useLibrary } from '@renderer/state/useLibrary';

/**
 * Makes sure the backdrop actually on screen exists at full size.
 *
 * Only `backdrops[0]` is fetched large at enrichment, so any other choice shows
 * its picker preview until it is upgraded. Firing that upgrade from the picker
 * alone was not enough: a pick made in an earlier session — or one that
 * survived a refetch — never passes through the picker again, so it stayed soft
 * forever. Displaying a backdrop is the honest trigger, because that is the
 * moment the full size is actually needed.
 *
 * Cheap to call repeatedly: the main side short-circuits when `fullPath` is
 * already set, and the effect only re-runs when the item or the pick changes.
 */
export function useFullBackdrop(item: LibraryItem | null, state: ProfileState | null): void {
  const ensureBackdropFull = useLibrary((s) => s.ensureBackdropFull);

  const backdrops = item?.metadata?.backdrops ?? [];
  const requested = item ? (state?.backdropChoice[item.id] ?? 0) : 0;
  // A pick can outlive a refetch that returned fewer images, and `backdropFor`
  // falls back to the first — so upgrade whichever one is really being shown.
  const index = backdrops[requested] ? requested : 0;
  const alreadyFull = backdrops[index]?.fullPath != null;

  useEffect(() => {
    if (!item || backdrops.length === 0 || alreadyFull) return;
    void ensureBackdropFull(item.id, index);
  }, [item?.id, index, alreadyFull, backdrops.length, ensureBackdropFull]);
}
