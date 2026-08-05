import { useOnEscape } from '@renderer/lib/useDismiss';
import { IconButton } from '@renderer/components/ui/IconButton';
import styles from './PosterLightbox.module.css';

interface PosterLightboxProps {
  src: string;
  onClose: () => void;
}

/**
 * Full-height view of the chosen poster. Cached artwork is w500, so it has
 * real detail worth seeing at a size the sidebar column cannot give it.
 */
export function PosterLightbox({ src, onClose }: PosterLightboxProps): React.JSX.Element {
  useOnEscape(onClose);

  return (
    <div className={styles.scrim} onMouseDown={onClose} role="dialog" aria-label="Poster">
      <IconButton
        icon="close"
        label="Close"
        size="lg"
        onArtwork
        className={styles.close}
        onClick={onClose}
      />
      <img
        className={styles.image}
        src={src}
        alt=""
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
