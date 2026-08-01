import { toMovieUrl } from '@shared/media-url';
import { progressOf } from '@shared/continue-watching';
import type { LibraryItem, ProfileState } from '@shared/types';
import { AUTO_ACCEPT_UI } from '@renderer/lib/constants';
import { displayTitle, displayYear, posterFor } from '@renderer/lib/selectors';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './MovieGrid.module.css';

interface MovieGridProps {
  items: LibraryItem[];
  profileState: ProfileState | null;
}

export function MovieGrid({ items, profileState }: MovieGridProps): React.JSX.Element {
  const { selectedId, select } = useUi();

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
          item.match.confidence < AUTO_ACCEPT_UI;

        return (
          <li key={item.id}>
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
                  <span className={styles.playButton}>
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
