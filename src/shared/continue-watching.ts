import type { Episode, LibraryItem, WatchEntry } from './types.js';

/**
 * Selection rules for the Continue Watching carousel. Pure so the thresholds
 * can be tested without a profile on disk or a player that produces progress.
 */

/** Below this you barely started; it belongs in the library, not the deck. */
export const MIN_PROGRESS = 0.02;
/** Above this you effectively finished, even if the credits never rolled. */
export const MAX_PROGRESS = 0.92;

export const CONTINUE_LIMIT = 10;

export interface ContinueEntry {
  /** The film, or the show an episode belongs to. */
  item: LibraryItem;
  /**
   * The episode this entry is for, or null when `item` is a film.
   *
   * Progress is stored against the episode id, not the show's, so a show can
   * appear here for an episode that is nothing like the rest of it. The card
   * has to say which one, which is why this is carried rather than resolved
   * again at the call site.
   */
  episode: Episode | null;
  entry: WatchEntry;
  /** 0–1. */
  progress: number;
}

export function progressOf(entry: WatchEntry): number {
  if (entry.durationSec <= 0) return 0;
  return Math.min(1, Math.max(0, entry.positionSec / entry.durationSec));
}

/** True when a film should appear in the deck. */
export function isResumable(entry: WatchEntry): boolean {
  if (entry.finished) return false;
  const progress = progressOf(entry);
  return progress > MIN_PROGRESS && progress < MAX_PROGRESS;
}

/**
 * Every id progress can be stored against, mapped to what it refers to.
 *
 * A show contributes one id per episode *and* its own. Playing an episode from
 * the sidebar stores progress against the episode, but the grid's play button
 * passes the show's id for anything it is given, and those entries predate the
 * episode list — dropping them here would empty the deck for anyone who had
 * started a show that way. Ids are hashes of paths — a folder's for an item, a
 * file's for an episode — so the two can never collide.
 */
function resolvable(
  items: LibraryItem[]
): Map<string, { item: LibraryItem; episode: Episode | null }> {
  const byId = new Map<string, { item: LibraryItem; episode: Episode | null }>();

  for (const item of items) {
    byId.set(item.id, { item, episode: null });
    for (const season of item.seasons ?? []) {
      for (const episode of season.episodes) byId.set(episode.id, { item, episode });
    }
  }

  return byId;
}

/**
 * Most recently watched first. Entries whose film has left the library are
 * dropped rather than rendered as a hole — a deleted folder should not
 * produce a broken card.
 */
export function continueWatching(
  watch: Record<string, WatchEntry>,
  items: LibraryItem[],
  limit: number = CONTINUE_LIMIT
): ContinueEntry[] {
  const byId = resolvable(items);

  return Object.values(watch)
    .filter(isResumable)
    .map((entry) => {
      const found = byId.get(entry.movieId);
      return found ? { ...found, entry, progress: progressOf(entry) } : null;
    })
    .filter((e): e is ContinueEntry => e !== null)
    .sort((a, b) => Date.parse(b.entry.updatedAt) - Date.parse(a.entry.updatedAt))
    .slice(0, limit);
}
