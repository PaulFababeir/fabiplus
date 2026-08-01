import type { LibraryItem, WatchEntry } from './types.js';

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
  item: LibraryItem;
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
 * Most recently watched first. Entries whose film has left the library are
 * dropped rather than rendered as a hole — a deleted folder should not
 * produce a broken card.
 */
export function continueWatching(
  watch: Record<string, WatchEntry>,
  items: LibraryItem[],
  limit: number = CONTINUE_LIMIT
): ContinueEntry[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  return Object.values(watch)
    .filter(isResumable)
    .map((entry) => {
      const item = byId.get(entry.movieId);
      return item ? { item, entry, progress: progressOf(entry) } : null;
    })
    .filter((e): e is ContinueEntry => e !== null)
    .sort((a, b) => Date.parse(b.entry.updatedAt) - Date.parse(a.entry.updatedAt))
    .slice(0, limit);
}
