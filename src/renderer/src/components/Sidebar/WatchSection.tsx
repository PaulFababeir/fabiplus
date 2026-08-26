import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

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
   * Which synopses are expanded, by episode id.
   *
   * A set rather than a single id: these are independent disclosures, not a
   * one-at-a-time accordion. Comparing two episodes is a real thing to want,
   * and collapsing the one just read to open the next is the worse default.
   * Ids are path hashes and unique across seasons, so switching season hides
   * the open rows without this needing to be cleared.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

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
          const label = episode.title ?? `Episode ${number ?? '?'}`;
          /*
           * Truthiness, not a null check. A catalog written before episode
           * synopses existed has no such key at all, and TMDB holds no synopsis
           * for plenty of episodes it does know about. Both cases must leave
           * the row exactly as it was — no toggle, nothing to reveal.
           */
          const synopsis = episode.overview ? episode.overview : null;
          const open = expanded.has(episode.id);
          const panelId = `episode-synopsis-${episode.id}`;

          return (
            <li
              key={episode.id}
              className={styles.item}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  id: episode.id,
                  label,
                  watched: watched?.finished === true,
                  x: e.clientX,
                  y: e.clientY
                });
              }}
            >
              <div className={styles.row} data-watched={watched?.finished === true}>
                <IconButton
                  icon="play"
                  label={`Play ${label}`}
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
                  <span className={styles.title}>{label}</span>
                  <span className={styles.sub}>
                    {[runtime, watched?.finished === true ? 'Watched' : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </span>
                </span>

                {synopsis && (
                  <button
                    type="button"
                    className={styles.expand}
                    data-open={open}
                    aria-expanded={open}
                    aria-controls={panelId}
                    aria-label={`${open ? 'Hide' : 'Show'} synopsis for ${label}`}
                    onClick={() => toggleExpanded(episode.id)}
                  >
                    <Icon name="chevron-down" size={13} />
                  </button>
                )}
              </div>

              {/*
                `initial={false}` so a row left open when the list remounts —
                switching tabs and coming back — is simply open, rather than
                replaying every expansion on arrival.
              */}
              <AnimatePresence initial={false}>
                {synopsis && open && (
                  <motion.div
                    key="synopsis"
                    id={panelId}
                    className={styles.synopsisWrap}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <p className={styles.synopsis}>{synopsis}</p>
                  </motion.div>
                )}
              </AnimatePresence>
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
