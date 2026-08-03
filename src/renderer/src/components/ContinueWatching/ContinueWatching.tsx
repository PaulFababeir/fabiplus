import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { continueWatching } from '@shared/continue-watching';
import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState } from '@shared/types';
import { displayTitle, displayYear, posterFor, runtimeLabel } from '@renderer/lib/selectors';
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
  const [index, setIndex] = useState(0);

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

  const { item, progress } = active;
  const backdrop = item.metadata?.backdrop?.localPath ?? null;
  const remaining = item.metadata?.runtimeMin
    ? runtimeLabel(Math.round(item.metadata.runtimeMin * (1 - progress)))
    : null;

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
              key={item.id}
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
            key={item.id}
            className={styles.info}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <h3 className={styles.title}>{displayTitle(item)}</h3>

            <p className={styles.sub}>
              {[displayYear(item), remaining && `${remaining} left`].filter(Boolean).join('  ·  ')}
            </p>

            <div className={styles.progressTrack}>
              <motion.div
                className={styles.progressFill}
                initial={{ width: 0 }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </div>

            <button type="button" className={styles.play} onClick={() => play(item.id)}>
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
              return (
                <motion.button
                  key={entry.item.id}
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
                  aria-label={
                    isActive
                      ? `${displayTitle(entry.item)} (showing)`
                      : `Show ${displayTitle(entry.item)}`
                  }
                  aria-current={isActive}
                  onClick={() => setIndex(position)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    select(entry.item.id);
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
    </section>
  );
}
