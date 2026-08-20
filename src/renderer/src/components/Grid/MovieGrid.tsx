import { useEffect, useRef } from 'react';

import { toMovieUrl } from '@shared/media-url';
import { progressOf } from '@shared/continue-watching';
import type { LibraryItem, ProfileState } from '@shared/types';
import { AUTO_ACCEPT } from '@shared/constants';
import { displayTitle, displayYear, posterFor } from '@renderer/lib/selectors';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './MovieGrid.module.css';

interface MovieGridProps {
  items: LibraryItem[];
  profileState: ProfileState | null;
}

export function MovieGrid({ items, profileState }: MovieGridProps): React.JSX.Element {
  const { selectedId, select, play, sidebarOpen } = useUi();
  const selectedRef = useRef<HTMLLIElement>(null);

  /*
   * Keep the selected card on screen.
   *
   * Opening the sidebar narrows the content column, so the grid reflows to
   * fewer cards per row and everything after the newcomer shifts down. The film
   * you just clicked could end up below the fold — still selected, still
   * described in the sidebar, but scrolled out of reach of its own play button.
   *
   * `nearest` scrolls only when it actually has to, so a card already in view
   * does not jolt. The frame's delay is what lets the reflow finish first;
   * measuring in the same tick reads the old layout.
   */
  useEffect(() => {
    if (selectedId === null) return;
    const frame = requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, sidebarOpen]);

  if (items.length === 0) {
    return <p className={styles.empty}>Nothing here. Try a different genre or search.</p>;
  }

  return (
    <ul className={styles.grid}>
      {items.map((item) => {
        const poster = posterFor(item, profileState);
        const entry = profileState?.watch[item.id];
        const progress = entry && !entry.finished ? progressOf(entry) : 0;
        const needsReview =
          item.match !== null &&
          !item.match.correctedByUser &&
          item.match.confidence < AUTO_ACCEPT;

        return (
          <li key={item.id} ref={item.id === selectedId ? selectedRef : undefined}>
            <button
              type="button"
              className={styles.card}
              data-selected={item.id === selectedId}
              onClick={() => select(item.id)}
            >
              <div className={styles.posterWrap}>
                {poster ? (
                  <img className={styles.poster} src={toMovieUrl(poster)} alt="" loading="lazy" />
                ) : (
                  <span className={styles.placeholder}>{displayTitle(item)}</span>
                )}

                {needsReview && <span className={styles.reviewFlag}>CHECK</span>}

                <span className={styles.overlay}>
                  {/*
                    A nested <button> is invalid, so the play affordance is a
                    span that stops propagation and starts playback directly.
                  */}
                  <span
                    className={styles.playButton}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Play ${displayTitle(item)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      play(item.id);
                    }}
                  >
                    <Icon name="play" size={20} />
                  </span>
                </span>

                {progress > 0 && (
                  <span className={styles.progressTrack}>
                    <span className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
                  </span>
                )}
              </div>

              <div className={styles.meta}>
                <div className={styles.title}>{displayTitle(item)}</div>
                <div className={styles.year}>{displayYear(item) ?? '—'}</div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
