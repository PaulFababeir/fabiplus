import { useMemo, useState } from 'react';

import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState, Season } from '@shared/types';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useUi } from '@renderer/state/useUi';
import styles from './WatchSection.module.css';

interface WatchSectionProps {
  item: LibraryItem;
  profileState: ProfileState | null;
}

/** "42 min", or null when the provider has not supplied a runtime. */
function runtimeLabel(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * The episode list for a show, laid out like an album: one row per episode,
 * title over a runtime subtext, play on the right.
 *
 * Seasons come from the folder tree rather than the provider, so a release with
 * an "Unaired Pilot" folder shows that folder — matching what is actually on
 * disk is more useful here than matching TMDB's numbering.
 */
export function WatchSection({ item, profileState }: WatchSectionProps): React.JSX.Element {
  const play = useUi((s) => s.play);
  const seasons = useMemo<Season[]>(() => item.seasons ?? [], [item.seasons]);

  const [seasonIndex, setSeasonIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  // A stale index outlives a rescan that returned fewer seasons.
  const season = seasons[Math.min(seasonIndex, seasons.length - 1)] ?? null;

  if (seasons.length === 0) {
    return <p className={styles.empty}>No episodes found in this folder.</p>;
  }

  return (
    <div className={styles.wrap}>
      {seasons.length > 1 && (
        <div className={styles.picker}>
          <button
            type="button"
            className={styles.pickerButton}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <span>{season?.label ?? 'Season'}</span>
            <Icon name="chevron-down" size={13} />
          </button>

          {pickerOpen && (
            <div className={styles.pickerMenu} role="listbox">
              {seasons.map((entry, i) => (
                <button
                  key={entry.label}
                  type="button"
                  role="option"
                  aria-selected={i === seasonIndex}
                  className={styles.pickerOption}
                  data-active={i === seasonIndex}
                  onClick={() => {
                    setSeasonIndex(i);
                    setPickerOpen(false);
                  }}
                >
                  <span>{entry.label}</span>
                  <span className={styles.pickerCount}>{entry.episodes.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ul className={styles.list}>
        {(season?.episodes ?? []).map((episode) => {
          const watched = profileState?.watch[episode.id];
          const number = episode.number === null ? null : String(episode.number).padStart(2, '0');
          const runtime = runtimeLabel(episode.runtimeMin);

          return (
            <li key={episode.id} className={styles.row} data-watched={watched?.finished === true}>
              <IconButton
                icon="play"
                label={`Play ${episode.title ?? `episode ${number ?? ''}`}`}
                size="sm"
                onClick={() => play(item.id, episode.id)}
              />

              {/*
                The number stays even with a still beside it: an episode
                thumbnail is often a plain frame of two people talking, which
                identifies nothing on its own.
              */}
              <span className={styles.number}>{number ?? '—'}</span>

              {episode.still && (
                <img
                  className={styles.still}
                  src={toMovieUrl(episode.still.localPath)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
              )}

              <span className={styles.text}>
                <span className={styles.title}>
                  {episode.title ?? `Episode ${number ?? '?'}`}
                </span>
                <span className={styles.sub}>
                  {[runtime, watched?.finished === true ? 'Watched' : null]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
