import { toMovieUrl } from '@shared/media-url';
import { BACKDROPS_PER_MOVIE } from '@shared/constants';
import type { LibraryItem } from '@shared/types';
import { displayTitle } from '@renderer/lib/selectors';
import { useOnEscape } from '@renderer/lib/useDismiss';
import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { IconButton } from '@renderer/components/ui/IconButton';
import styles from './Modal.module.css';

interface BackdropPickerProps {
  item: LibraryItem;
  /** Index into `item.metadata.backdrops` this profile currently uses. */
  chosenIndex: number;
  onClose: () => void;
}

/**
 * Backdrop chooser — the poster picker at a 16:9 ratio, and per-profile for the
 * same reason.
 *
 * Fewer cells per row than the posters get: a backdrop is mostly one image at
 * low contrast behind the sidebar text, and at poster width the differences
 * between twenty plates of the same film are impossible to see.
 */
export function BackdropPicker({
  item,
  chosenIndex,
  onClose
}: BackdropPickerProps): React.JSX.Element {
  const chooseBackdrop = useProfile((s) => s.chooseBackdrop);
  const ensureBackdropFull = useLibrary((s) => s.ensureBackdropFull);
  const backdrops = item.metadata?.backdrops ?? [];

  useOnEscape(onClose);

  return (
    <div className={styles.scrim} onMouseDown={onClose}>
      <div
        className={`${styles.dialog} ${styles.wideDialog}`}
        role="dialog"
        aria-label={`Choose a backdrop for ${displayTitle(item)}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 className={styles.heading}>Choose a backdrop — {displayTitle(item)}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div className={styles.body}>
          {backdrops.length === 0 ? (
            <p className={styles.emptyReview}>No backdrops cached for this film yet.</p>
          ) : (
            <>
              <div className={styles.backdropGrid}>
                {backdrops.map((backdrop, i) => (
                  <button
                    key={backdrop.remotePath}
                    type="button"
                    className={styles.backdropOption}
                    data-active={i === chosenIndex}
                    aria-label={`Use backdrop ${i + 1} of ${backdrops.length}`}
                    aria-pressed={i === chosenIndex}
                    onClick={() => {
                      void chooseBackdrop(item.id, i);
                      // Only the default is cached at full size, so the pick
                      // shows its preview until this lands. Fired after the
                      // choice, not awaited — the dialog should not sit open
                      // waiting on a download.
                      void ensureBackdropFull(item.id, i);
                      onClose();
                    }}
                  >
                    <img src={toMovieUrl(backdrop.localPath)} alt="" loading="lazy" />
                    {i === chosenIndex && <span className={styles.posterBadge}>In use</span>}
                  </button>
                ))}
              </div>

              {/*
                A catalog enriched before backdrops were selectable carries
                exactly one, so this is the normal state on an existing install
                rather than an edge case.
              */}
              {backdrops.length < BACKDROPS_PER_MOVIE && (
                <p className={styles.note}>
                  {backdrops.length} of up to {BACKDROPS_PER_MOVIE} cached. Films enriched before
                  backdrops became selectable have only the one. Run <strong>Refetch all</strong> in
                  Settings to pull the rest.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
