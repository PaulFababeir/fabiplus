import { useEffect, useState } from 'react';

import { continueWatching, type ContinueEntry } from '@shared/continue-watching';
import { toMovieUrl } from '@shared/media-url';
import type { LibraryItem, ProfileState } from '@shared/types';
import { displayTitle, displayYear, runtimeLabel } from '@renderer/lib/selectors';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './ContinueWatching.module.css';

/** How many cards peek out behind the front one. */
const GHOST_COUNT = 2;

interface ContinueWatchingProps {
  items: LibraryItem[];
  profileState: ProfileState | null;
}

export function ContinueWatching({
  items,
  profileState
}: ContinueWatchingProps): React.JSX.Element | null {
  const select = useUi((s) => s.select);
  const [index, setIndex] = useState(0);

  const deck = continueWatching(profileState?.watch ?? {}, items);

  // Keep the cursor valid when the deck shrinks (a film finished or was removed).
  useEffect(() => {
    if (index >= deck.length) setIndex(0);
  }, [deck.length, index]);

  if (deck.length === 0) return null;

  const active = deck[Math.min(index, deck.length - 1)];
  if (!active) return null;

  const step = (direction: -1 | 1): void => {
    setIndex((current) => (current + direction + deck.length) % deck.length);
  };

  return (
    <section className={styles.section} data-interactive>
      <h2 className={styles.heading}>Continue watching</h2>

      <div className={styles.deck}>
        {/* Decorative cards behind, drawn back-to-front. */}
        {Array.from({ length: Math.min(GHOST_COUNT, deck.length - 1) }, (_, i) => {
          const depth = Math.min(GHOST_COUNT, deck.length - 1) - i;
          return (
            <div
              key={`ghost-${depth}`}
              className={`${styles.card} ${styles.ghost}`}
              style={{
                transform: `translate(${depth * 13}px, ${depth * -11}px) scale(${1 - depth * 0.018})`,
                opacity: 0.45 - depth * 0.12
              }}
              aria-hidden="true"
            />
          );
        })}

        <div className={styles.card}>
          <button type="button" className={styles.front} onClick={() => select(active.item.id)}>
            <CardFace entry={active} />
          </button>
        </div>

        {deck.length > 1 && (
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

      {deck.length > 1 && (
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

function CardFace({ entry }: { entry: ContinueEntry }): React.JSX.Element {
  const { item, progress } = entry;
  const backdrop = item.metadata?.backdrop?.localPath ?? null;
  const remaining = item.metadata?.runtimeMin
    ? runtimeLabel(Math.round(item.metadata.runtimeMin * (1 - progress)))
    : null;

  return (
    <>
      {backdrop && <img className={styles.backdrop} src={toMovieUrl(backdrop)} alt="" />}
      <span className={styles.scrim} />

      <span className={styles.content}>
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
        <span className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
      </span>
    </>
  );
}
