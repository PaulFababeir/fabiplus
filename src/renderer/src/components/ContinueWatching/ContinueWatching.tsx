import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';

import { continueWatching, type ContinueEntry } from '@shared/continue-watching';
import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState } from '@shared/types';
import { displayTitle, displayYear, runtimeLabel } from '@renderer/lib/selectors';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './ContinueWatching.module.css';

/** Cards rendered at once: the hero plus two peeking behind it. */
const VISIBLE = 3;
/** Horizontal drag past this fraction of the card advances the deck. */
const SWIPE_RATIO = 0.18;

/**
 * Transform for each slot in the stack. Slot 0 is the hero; the rest fan out
 * to the right at decreasing scale, matching the Figma treatment.
 */
const SLOTS = [
  { x: '0%', scale: 1, opacity: 1, blur: 0 },
  { x: '18%', scale: 0.87, opacity: 0.5, blur: 1.5 },
  { x: '38%', scale: 0.78, opacity: 0.28, blur: 3 }
] as const;

const SPRING = { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 } as const;

interface ContinueWatchingProps {
  items: LibraryItem[];
  profileState: ProfileState | null;
}

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

  const onDragEnd = (_e: unknown, info: PanInfo, width: number): void => {
    const threshold = width * SWIPE_RATIO;
    // Velocity lets a quick flick advance without dragging the full distance.
    if (info.offset.x < -threshold || info.velocity.x < -600) step(1);
    else if (info.offset.x > threshold || info.velocity.x > 600) step(-1);
  };

  if (total === 0) return null;

  // Slots are filled from the current index, wrapping, so the deck is endless.
  const slots = Array.from({ length: Math.min(VISIBLE, total) }, (_, offset) => ({
    slot: offset,
    entry: deck[(index + offset) % total]!
  }));

  return (
    <section className={styles.section} aria-roledescription="carousel">
      <h2 className={styles.heading}>Continue watching</h2>

      <div className={styles.deck}>
        {/* Painted back-to-front so the hero ends up on top. */}
        {[...slots].reverse().map(({ slot, entry }) => {
          const pose = SLOTS[slot] ?? SLOTS[SLOTS.length - 1]!;
          const isFront = slot === 0;

          return (
            <motion.div
              key={entry.item.id}
              className={styles.card}
              style={{ zIndex: VISIBLE - slot }}
              initial={false}
              animate={{
                x: pose.x,
                scale: pose.scale,
                opacity: pose.opacity,
                filter: `blur(${pose.blur}px)`
              }}
              transition={SPRING}
              drag={isFront && total > 1 ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.16}
              onDragEnd={(e, info) =>
                onDragEnd(e, info, (e.currentTarget as HTMLElement).clientWidth)
              }
              aria-hidden={!isFront}
            >
              {isFront ? (
                <button
                  type="button"
                  className={styles.front}
                  onClick={() => play(entry.item.id)}
                  onContextMenu={(e) => {
                    // Right-click opens details rather than resuming.
                    e.preventDefault();
                    select(entry.item.id);
                  }}
                >
                  <CardFace entry={entry} />
                </button>
              ) : (
                <div className={styles.front}>
                  <CardFace entry={entry} muted />
                </div>
              )}
            </motion.div>
          );
        })}

        {total > 1 && (
          <>
            <button
              type="button"
              className={`${styles.nav} ${styles.navPrev}`}
              aria-label="Previous"
              onClick={() => step(-1)}
            >
              <Icon name="chevron-left" size={18} />
            </button>
            <button
              type="button"
              className={`${styles.nav} ${styles.navNext}`}
              aria-label="Next"
              onClick={() => step(1)}
            >
              <Icon name="chevron-right" size={18} />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <div className={styles.dots}>
          {deck.map((entry, i) => (
            <button
              key={entry.item.id}
              type="button"
              className={styles.dot}
              data-active={i === index}
              aria-label={`Show ${displayTitle(entry.item)}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CardFace({ entry, muted = false }: { entry: ContinueEntry; muted?: boolean }): React.JSX.Element {
  const { item, progress } = entry;
  const backdrop = item.metadata?.backdrop?.localPath ?? null;
  const remaining = item.metadata?.runtimeMin
    ? runtimeLabel(Math.round(item.metadata.runtimeMin * (1 - progress)))
    : null;

  return (
    <>
      {backdrop && (
        <img className={styles.backdrop} src={toMovieUrl(backdrop)} alt="" draggable={false} />
      )}
      <span className={styles.scrim} />

      {/* Cards behind show artwork only — text at that scale is just noise. */}
      {!muted && (
        <AnimatePresence mode="wait">
          <motion.span
            key={item.id}
            className={styles.content}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            <span className={styles.contentRow}>
              <span className={styles.info}>
                <h3 className={styles.title}>{displayTitle(item)}</h3>
                <span className={styles.sub}>
                  {displayYear(item) ?? '—'}
                  {remaining && ` · ${remaining} left`}
                </span>
              </span>
              <span className={styles.play}>
                <Icon name="play" size={22} />
              </span>
            </span>

            <span className={styles.progressTrack}>
              <motion.span
                className={styles.progressFill}
                initial={{ width: 0 }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            </span>
          </motion.span>
        </AnimatePresence>
      )}
    </>
  );
}
