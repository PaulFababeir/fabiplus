import type { Episode, LibraryItem } from './types.js';

/**
 * What plays after the episode that just ended.
 *
 * Pure, and apart from the player, because the interesting cases are all about
 * how a real release is laid out on disk rather than about video: seasons come
 * from folders, not from the provider, so their numbering has gaps and some of
 * them are not seasons at all.
 */

/**
 * The next episode in play order, or null when nothing follows.
 *
 * Within a season the scanner's order is authoritative — it puts numbered
 * episodes first and unnumbered ones last, which is the order a viewer expects.
 *
 * At a season boundary the roll-over is by season *number*, not folder
 * position: a "Specials" or "Unaired Pilot" folder sorts wherever the
 * filesystem put it, and finishing S01E03 must not drop the viewer into a
 * one-off pilot. For the same reason an unnumbered folder never rolls over at
 * all — there is no "next" after a special, only a guess.
 */
export function nextEpisode(item: LibraryItem, currentEpisodeId: string): Episode | null {
  const seasons = item.seasons ?? [];
  const season = seasons.find((s) => s.episodes.some((e) => e.id === currentEpisodeId));
  if (!season) return null;

  const at = season.episodes.findIndex((e) => e.id === currentEpisodeId);
  const withinSeason = season.episodes[at + 1];
  if (withinSeason) return withinSeason;

  const current = season.number;
  if (current === null) return null;

  const following = seasons
    .filter((s): s is typeof s & { number: number } => s.number !== null && s.number > current)
    .sort((a, b) => a.number - b.number);

  return following[0]?.episodes[0] ?? null;
}
