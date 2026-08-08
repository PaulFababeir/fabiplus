import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { continueWatching, type ContinueEntry } from '@shared/continue-watching';
import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState } from '@shared/types';
import { useOnClickOutside, useOnEscape } from '@renderer/lib/useDismiss';
import { useProfile } from '@renderer/state/useProfile';
import {
  backdropFor,
  displayTitle,
  displayYear,
  posterFor,
  runtimeLabel
} from '@renderer/lib/selectors';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './ContinueWatching.module.css';

/**
 * Poster cards on the right: the film currently on the plate, then the ones
 * queued behind it. Including the active poster gives the row an anchor, so
 * cycling reads as movement through a list rather than cards appearing from
 * nowhere.
 */
const QUEUE_SIZE = 3;

const EASE = [0.16, 1, 0.3, 1] as const;

/** Kept in step with `.menu` in the stylesheet, for the edge clamp only. */
const MENU_WIDTH = 190;
const MENU_HEIGHT = 84;

/**
 * "S01E03 · The Great Game", or null for a film.
 *
 * The show's title is already the headline, so this is what tells you which of
 * its forty episodes the card is actually offering to resume.
 */
function episodeLabel({ item, episode }: ContinueEntry): string | null {
  if (episode === null) return null;

  const season = (item.seasons ?? []).find((s) => s.episodes.some((e) => e.id === episode.id));
  const number = episode.number === null ? null : String(episode.number).padStart(2, '0');
  const code =
    season?.number != null && number
      ? `S${String(season.number).padStart(2, '0')}E${number}`
      : (season?.label ?? null);

  return [code, episode.title].filter(Boolean).join('  ·  ') || null;
}

/**
 * Time left, preferring the provider's runtime and falling back to what the
 * player actually measured. An episode rarely has a runtime before its season
 * has been enriched, and the stored duration is exact anyway.
 */
function remainingLabel({ item, episode, entry, progress }: ContinueEntry): string | null {
  const runtimeMin = episode ? episode.runtimeMin : (item.metadata?.runtimeMin ?? null);
  if (runtimeMin) return runtimeLabel(Math.round(runtimeMin * (1 - progress)));
  if (entry.durationSec > 0) {
    return runtimeLabel(Math.round((entry.durationSec - entry.positionSec) / 60));
  }
  return null;
}

interface ContinueWatchingProps {
  items: LibraryItem[];
  profileState: ProfileState | null;
}

/**
 * The active film's backdrop fills the stage and carries its title, remaining
 * time and a play button; the films queued behind it appear as posters on the
 * right. Cycling swaps all of it together.
 */
export function ContinueWatching({
  items,
  profileState
}: ContinueWatchingProps): React.JSX.Element | null {
  const play = useUi((s) => s.play);
  const select = useUi((s) => s.select);
  const setFinished = useProfile((s) => s.setFinished);
  const [index, setIndex] = useState(0);

  /**
   * Right-click menu for one card, positioned at the pointer. Right-click used
   * to select the film outright, so that action stays in the menu — removing it
   * to make room for "mark as watched" would be a straight trade, not a gain.
   */
  const [menu, setMenu] = useState<{
    /** What progress is stored against — an episode id for a show. */
    id: string;
    /** The catalog item, which is what the sidebar can open. */
    itemId: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useOnClickOutside(menuRef, closeMenu, menu !== null);
  useOnEscape(closeMenu, menu !== null);

  const deck = continueWatching(profileState?.watch ?? {}, items);
  const total = deck.length;

  // Keep the cursor valid when the deck shrinks — a film finished, or its
  // folder disappeared between rescans.
  useEffect(() => {
    if (total > 0 && index >= total) setIndex(0);
  }, [total, index]);

  const step = useCallback(
    (direction: -1 | 1) => {
      setIndex((current) => (current + direction + total) % total);
    },
    [total]
  );

  if (total === 0) return null;

  const active = deck[index % total];
  if (!active) return null;

  const { item, episode, progress } = active;
  const backdrop = backdropFor(item, profileState);
  const remaining = remainingLabel(active);

  // Starts at the active film so the row shows what is playing plus what is next.
  const queue = Array.from({ length: Math.min(QUEUE_SIZE, total) }, (_, offset) => ({
    entry: deck[(index + offset) % total]!,
    position: (index + offset) % total,
    isActive: offset === 0
  }));

  return (
    <section className={styles.section} aria-roledescription="carousel">
      <h2 className={styles.heading}>Continue watching</h2>

      <div className={styles.stage}>
        {/* Crossfaded rather than swapped, so cycling reads as a transition. */}
        <AnimatePresence initial={false}>
          {backdrop && (
            <motion.img
              key={backdrop}
              className={styles.backdrop}
              src={toMovieUrl(backdrop)}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: EASE }}
            />
          )}
        </AnimatePresence>

        <div className={styles.scrim} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            /* Keyed on what is being resumed, not the show — two episodes of
               one series are two cards and must animate between each other. */
            key={episode?.id ?? item.id}
            className={styles.info}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <h3 className={styles.title}>{displayTitle(item)}</h3>

            {episodeLabel(active) && <p className={styles.episode}>{episodeLabel(active)}</p>}

            <p className={styles.sub}>
              {[episode ? null : displayYear(item), remaining && `${remaining} left`]
                .filter(Boolean)
                .join('  ·  ')}
            </p>

            <div className={styles.progressTrack}>
              <motion.div
                className={styles.progressFill}
                initial={{ width: 0 }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </div>

            <button
              type="button"
              className={styles.play}
              onClick={() => play(item.id, episode?.id)}
            >
              <Icon name="play" size={15} />
              Resume
            </button>
          </motion.div>
        </AnimatePresence>

        {queue.length > 0 && (
          <div className={styles.thumbs}>
            {/*
              `popLayout` takes leaving cards out of flow immediately, so the
              rest slide across cleanly instead of the newcomer appearing to
              crawl out from under its neighbour.
            */}
            <AnimatePresence initial={false} mode="popLayout">
              {queue.map(({ entry, position, isActive }) => {
              const poster = posterFor(entry.item, profileState);
              // What this card resumes. Two episodes of one show are two cards,
              // so the show's id is not unique enough to key them by.
              const resumeId = entry.episode?.id ?? entry.item.id;
              const label = [displayTitle(entry.item), episodeLabel(entry)]
                .filter(Boolean)
                .join(' — ');
              return (
                <motion.button
                  key={resumeId}
                  type="button"
                  className={styles.thumb}
                  data-active={isActive}
                  layout
                  // Cards drop in from above and fall away downward, so a new
                  // poster never looks like it is sliding out from beneath the
                  // one beside it.
                  initial={{ opacity: 0, y: -34, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 34, scale: 0.94 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  aria-label={isActive ? `${label} (showing)` : `Show ${label}`}
                  aria-current={isActive}
                  onClick={() => setIndex(position)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      // Marked against what was watched — the episode, not the
                      // show, or finishing one would retire the whole series.
                      id: resumeId,
                      itemId: entry.item.id,
                      title: label,
                      x: e.clientX,
                      y: e.clientY
                    });
                  }}
                >
                  {poster ? (
                    <img
                      className={styles.thumbImage}
                      src={toMovieUrl(poster)}
                      alt=""
                      draggable={false}
                    />
                  ) : (
                    <span className={styles.thumbFallback}>{displayTitle(entry.item)}</span>
                  )}

                  <span className={styles.thumbProgress}>
                    <span
                      className={styles.thumbProgressFill}
                      style={{ width: `${entry.progress * 100}%` }}
                    />
                  </span>
                </motion.button>
              );
              })}
            </AnimatePresence>
          </div>
        )}

        {total > 1 && (
          <div className={styles.nav}>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Previous"
              onClick={() => step(-1)}
            >
              <Icon name="chevron-left" size={15} />
            </button>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Next"
              onClick={() => step(1)}
            >
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
        )}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label={menu.title}
          /* Clamped so a card near the right or bottom edge does not open a
             menu half off-screen. */
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
              void setFinished(menu.id, true);
              closeMenu();
            }}
          >
            <Icon name="check" size={14} />
            Mark as watched
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              select(menu.itemId);
              closeMenu();
            }}
          >
            <Icon name="more" size={14} />
            Show details
          </button>
        </div>
      )}
    </section>
  );
}
