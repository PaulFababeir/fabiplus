import styles from './Toggle.module.css';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** Secondary line under the label. */
  hint?: string;
  disabled?: boolean;
}

/**
 * A switch, for settings that are plainly on or off.
 *
 * `role="switch"` rather than a styled checkbox: screen readers announce it as
 * on/off, and the whole row is the hit target — a 40px switch alone is a mean
 * thing to aim at.
 */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false
}: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={styles.row}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>

      <span className={styles.track} data-on={checked} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
