import { useOnEscape } from '@renderer/lib/useDismiss';
import { Icon } from '@renderer/components/ui/Icon';
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
      <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
      <img
        className={styles.image}
        src={src}
        alt=""
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
