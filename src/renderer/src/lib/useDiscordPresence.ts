import { useEffect, useMemo, useRef } from 'react';

import { buildPresence, discordArtwork, type PresenceFilm } from '@shared/presence';
import type { LibraryItem } from '@shared/types';
import type { PlaybackStatus } from '@renderer/state/useUi';
import { displayTitle, displayYear } from './selectors';

/**
 * The one place that publishes to Discord.
 *
 * It lives at the app shell rather than in the player because the presence has
 * to describe the library view too. When the player owned it, exiting a film
 * cleared the presence, and Discord fell back to the bare detected-app line —
 * app name and an elapsed timer, no title, no artwork. Two writers would have
 * raced instead: the player's unmount clear would land after the shell's
 * update and blank it again.
 */

function toFilm(item: LibraryItem | null): PresenceFilm | null {
  if (!item) return null;
  return {
    title: displayTitle(item),
    year: displayYear(item),
    genre: item.metadata?.genres[0] ?? null,
    image: discordArtwork(item)
  };
}

interface PresenceArgs {
  /** The film open in the player, or null in the library view. */
  playing: LibraryItem | null;
  /** The film chosen in the library. */
  selected: LibraryItem | null;
  playback: PlaybackStatus;
  libraryCount: number;
  /** Changes when the Discord settings do, forcing a re-publish. */
  epoch: number;
}

export function useDiscordPresence({
  playing,
  selected,
  playback,
  libraryCount,
  epoch
}: PresenceArgs): void {
  const activity = useMemo(
    () =>
      buildPresence({
        film: toFilm(playing),
        playing: playback.playing,
        remainingSec:
          playback.durationSec > 0
            ? Math.max(0, Math.round(playback.durationSec - playback.positionSec))
            : null,
        selected: toFilm(selected),
        libraryCount
      }),
    [playing, selected, playback, libraryCount]
  );

  // Compared by value: the shell re-renders on every keystroke in the search
  // box, and none of that changes what Discord should be showing.
  const encoded = JSON.stringify(activity);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const key = `${epoch}:${encoded}`;
    if (last.current === key) return;
    last.current = key;
    void window.api.setDiscordActivity(activity);
    // `activity` is the parsed form of `encoded`; depending on both would fire
    // on every render, which is the thing the comparison above exists to stop.
  }, [encoded, epoch]);
}
