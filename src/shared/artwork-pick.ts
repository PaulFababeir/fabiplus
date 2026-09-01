import type { ArtworkPick } from './types.js';

/**
 * Resolves a profile's artwork choice to a position in the current image list.
 *
 * Picks used to be stored as a bare index, which is not a reference to an
 * image — it is a reference to a position. A refetch rebuilds `metadata.posters`
 * and re-ranks it (language first, then TMDB's live `vote_average`), so one new
 * poster, one deletion, or one vote shifting the order was enough to make index
 * 4 a different picture. Nothing detected it: the index was still in range, and
 * the user's choice silently became someone else's.
 *
 * A path identifies the image itself and survives all of that, so it is what
 * every pick written from schema 3 onward stores. A number here is legacy, and
 * still resolves the old way until `normalisePicks` converts it.
 *
 * Falls back to 0 rather than throwing: a choice outlives a refetch that
 * dropped the image entirely, and the provider's own best is the right answer
 * when the one that was chosen no longer exists.
 */
export function pickedIndex(
  images: readonly { remotePath: string }[],
  pick: ArtworkPick | undefined
): number {
  if (typeof pick === 'string') {
    const found = images.findIndex((image) => image.remotePath === pick);
    return found === -1 ? 0 : found;
  }

  if (typeof pick === 'number' && Number.isInteger(pick) && pick >= 0 && pick < images.length) {
    return pick;
  }

  return 0;
}

/**
 * The provider path a pick resolves to, or null when there is nothing to point
 * at. Used when writing a pick, so the caller never has to know that the wire
 * format is a path rather than the index it is holding.
 */
export function pickedPath(
  images: readonly { remotePath: string }[],
  pick: ArtworkPick | undefined
): string | null {
  return images[pickedIndex(images, pick)]?.remotePath ?? null;
}
