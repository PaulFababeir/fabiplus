import { pickedPath } from '@shared/artwork-pick';
import type { ArtworkPick, CachedImage, LibraryItem, ProfileState } from '@shared/types';

/**
 * Converts legacy index picks into provider paths, once the catalog is in hand.
 *
 * Apart from `profiles.ts` for the usual reason: that module reaches `config.ts`,
 * which imports `electron`, so no test can load it. This is the part that can
 * quietly rewrite a profile's artwork choices, so it lives where it can be
 * tested — same split as `library-merge.ts` and `profile-rules.ts`.
 *
 * Returns null when nothing changed, so the caller can skip the write entirely
 * rather than rewriting an untouched profile on every launch.
 */
export function normalisePicks(
  state: ProfileState,
  items: readonly LibraryItem[]
): ProfileState | null {
  /*
   * An empty catalog is the dangerous case, not a trivial one. Before the first
   * scan — or if the library failed to load — every pick would resolve to
   * nothing, and writing that back would erase choices that are perfectly good.
   * Doing nothing is always safe here; the next launch with a real catalog
   * finishes the job.
   */
  if (items.length === 0) return null;

  const byId = new Map(items.map((item) => [item.id, item]));

  const poster = convert(state.posterChoice, byId, (item) => item.metadata?.posters ?? []);
  const backdrop = convert(state.backdropChoice, byId, (item) => item.metadata?.backdrops ?? []);

  if (!poster && !backdrop) return null;

  return {
    ...state,
    posterChoice: poster ?? state.posterChoice,
    backdropChoice: backdrop ?? state.backdropChoice
  };
}

/**
 * One field's worth of conversion, or null when every entry was already a path.
 *
 * An entry whose film is gone from the catalog is left exactly as it is. It
 * cannot be resolved, and dropping it would lose the choice for a film that may
 * simply be on a drive that is not plugged in.
 */
function convert(
  choices: Record<string, ArtworkPick>,
  byId: ReadonlyMap<string, LibraryItem>,
  imagesOf: (item: LibraryItem) => CachedImage[]
): Record<string, ArtworkPick> | null {
  let changed = false;
  const next: Record<string, ArtworkPick> = {};

  for (const [itemId, pick] of Object.entries(choices)) {
    if (typeof pick === 'string') {
      next[itemId] = pick;
      continue;
    }

    const item = byId.get(itemId);
    const path = item ? pickedPath(imagesOf(item), pick) : null;

    if (path === null) {
      next[itemId] = pick;
      continue;
    }

    next[itemId] = path;
    changed = true;
  }

  return changed ? next : null;
}
