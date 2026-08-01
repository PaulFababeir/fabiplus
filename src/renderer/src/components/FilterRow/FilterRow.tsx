import { useEffect, useRef, useState } from 'react';

import type { SortKey } from '@shared/types';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './FilterRow.module.css';

const SORT_LABELS: Record<SortKey, string> = {
  alphabetical: 'A–Z',
  'release-date': 'Release date',
  'recently-added': 'Recently added'
};

interface FilterRowProps {
  genres: string[];
}

export function FilterRow({ genres }: FilterRowProps): React.JSX.Element {
  const { genre, setGenre, sort, setSort } = useUi();
  const trackRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  const [sortOpen, setSortOpen] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Track overflow so the pager buttons can disable at either end.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const update = (): void => {
      setCanScrollLeft(track.scrollLeft > 4);
      setCanScrollRight(track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
    };

    update();
    track.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(track);

    return () => {
      track.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [genres]);

  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [sortOpen]);

  /** Scrolls by most of a viewport width, leaving a little overlap. */
  const page = (direction: -1 | 1): void => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div className={styles.row}>
      <div className={styles.track} ref={trackRef}>
        <button
          type="button"
          className={styles.pill}
          data-active={genre === null}
          onClick={() => setGenre(null)}
        >
          All
        </button>
        {genres.map((name) => (
          <button
            key={name}
            type="button"
            className={styles.pill}
            data-active={genre === name}
            onClick={() => setGenre(genre === name ? null : name)}
          >
            {name}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={styles.circle}
        aria-label="Previous genres"
        disabled={!canScrollLeft}
        onClick={() => page(-1)}
      >
        <Icon name="chevron-left" size={15} />
      </button>
      <button
        type="button"
        className={styles.circle}
        aria-label="More genres"
        disabled={!canScrollRight}
        onClick={() => page(1)}
      >
        <Icon name="chevron-right" size={15} />
      </button>

      <div className={styles.sortWrap} ref={sortRef}>
        <button
          type="button"
          className={styles.sort}
          aria-haspopup="menu"
          aria-expanded={sortOpen}
          onClick={() => setSortOpen((v) => !v)}
        >
          <span>{SORT_LABELS[sort]}</span>
          <Icon name="chevron-down" size={13} />
        </button>

        {sortOpen && (
          <div className={styles.sortMenu} role="menu">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={styles.sortOption}
                data-active={sort === key}
                onClick={() => {
                  setSort(key);
                  setSortOpen(false);
                }}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
