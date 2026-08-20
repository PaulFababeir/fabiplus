import { useCallback, useMemo, useRef, useState } from 'react';

import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState, Season } from '@shared/types';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useUi } from '@renderer/state/useUi';
import { useProfile } from '@renderer/state/useProfile';
import { useOnClickOutside, useOnEscape } from '@renderer/lib/useDismiss';
import styles from './WatchSection.module.css';

/** Kept in step with `.menu` in the stylesheet, for the edge clamp only. */
const MENU_WIDTH = 200;
const MENU_HEIGHT = 44;

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
  const setFinished = useProfile((s) => s.setFinished);
  const seasons = useMemo<Season[]>(() => item.seasons ?? [], [item.seasons]);

  const [seasonIndex, setSeasonIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  /**
   * Right-click menu for one episode, positioned at the pointer — the same
   * gesture Continue Watching uses, so marking something watched works the same
   * way wherever you happen to be looking at it.
   */
  const [menu, setMenu] = useState<{
    id: string;
    label: string;
    watched: boolean;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useOnClickOutside(menuRef, closeMenu, menu !== null);
  useOnEscape(closeMenu, menu !== null);

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
            <li
              key={episode.id}
              className={styles.row}
              data-watched={watched?.finished === true}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  id: episode.id,
                  label: episode.title ?? `Episode ${number ?? '?'}`,
                  watched: watched?.finished === true,
                  x: e.clientX,
                  y: e.clientY
                });
              }}
            >
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

      {menu && (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label={menu.label}
          /* Clamped so an episode near the bottom of a long season does not
             open its menu off-screen. */
          style={{
            left: Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8),
            top: Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8)
          }}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              // A toggle, not a one-way door: marking the wrong episode by
              // accident should be undone the same way it was done.
              void setFinished(menu.id, !menu.watched);
              closeMenu();
            }}
          >
            <Icon name="check" size={14} />
            {menu.watched ? 'Mark as unwatched' : 'Mark as watched'}
          </button>
        </div>
      )}
    </div>
  );
}
