import { Icon, type IconName } from './Icon';
import styles from './IconButton.module.css';

/** Box and glyph sizes travel together so they cannot drift apart. */
const GLYPH: Record<'sm' | 'md' | 'lg' | 'xl', number> = { sm: 12, md: 15, lg: 17, xl: 22 };

interface IconButtonProps {
  icon: IconName;
  /** Accessible name — these buttons have no visible text. */
  label: string;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  /** Adds a shadow for buttons that sit over a poster rather than a panel. */
  onArtwork?: boolean;
  /** Positioning from the call site; visuals stay owned here. */
  className?: string;
}

/**
 * An icon-only button.
 *
 * Exists so dismiss affordances look and behave the same everywhere. Call sites
 * pass a `className` for placement only — anything that changes how it looks on
 * hover belongs in this component, or the divergence starts again.
 */
export function IconButton({
  icon,
  label,
  onClick,
  size = 'md',
  disabled = false,
  onArtwork = false,
  className
}: IconButtonProps): React.JSX.Element {
  const classes = [styles.button, styles[size], onArtwork && styles.onArtwork, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={GLYPH[size]} />
    </button>
  );
}
