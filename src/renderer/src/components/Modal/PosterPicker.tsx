
import { toMovieUrl } from '@shared/media-url';
import { POSTERS_PER_MOVIE } from '@shared/constants';
import type { LibraryItem } from '@shared/types';
import { displayTitle } from '@renderer/lib/selectors';
import { useOnEscape } from '@renderer/lib/useDismiss';
import { useProfile } from '@renderer/state/useProfile';
import { IconButton } from '@renderer/components/ui/IconButton';
import styles from './Modal.module.css';

interface PosterPickerProps {
  item: LibraryItem;
  /** Index into `item.metadata.posters` this profile currently uses. */
  chosenIndex: number;
  onClose: () => void;
}

/**
 * Poster chooser. A popup rather than an inline strip because ten 2:3 posters
 * will not read at any size that fits in the sidebar column.
 *
 * The choice is per-profile, so two people can keep different artwork for the
 * same film.
 */
export function PosterPicker({ item, chosenIndex, onClose }: PosterPickerProps): React.JSX.Element {
  const choosePoster = useProfile((s) => s.choosePoster);
  const posters = item.metadata?.posters ?? [];

  useOnEscape(onClose);

  return (
    <div className={styles.scrim} onMouseDown={onClose}>
      <div
        className={`${styles.dialog} ${styles.wideDialog}`}
        role="dialog"
        aria-label={`Choose a poster for ${displayTitle(item)}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 className={styles.heading}>Choose a poster — {displayTitle(item)}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div className={styles.body}>
          {posters.length === 0 ? (
            <p className={styles.emptyReview}>No artwork cached for this film yet.</p>
          ) : (
            <>
              <div className={styles.posterGrid}>
                {posters.map((poster, i) => (
                  <button
                    key={poster.remotePath}
                    type="button"
                    className={styles.posterOption}
                    data-active={i === chosenIndex}
                    aria-label={`Use poster ${i + 1} of ${posters.length}`}
                    aria-pressed={i === chosenIndex}
                    onClick={() => {
                      void choosePoster(item.id, i);
                      onClose();
                    }}
                  >
                    <img src={toMovieUrl(poster.localPath)} alt="" loading="lazy" />
                    {i === chosenIndex && <span className={styles.posterBadge}>In use</span>}
                  </button>
                ))}
              </div>

              {posters.length < POSTERS_PER_MOVIE && (
                <p className={styles.note}>
                  {posters.length} of up to {POSTERS_PER_MOVIE} cached. Run{' '}
                  <strong>Refetch all</strong> in Settings to pull the rest — films enriched under
                  an older limit, or before foreign-language artwork was included, will have fewer.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
