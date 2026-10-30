import styles from './SettingRow.module.css';

interface SettingRowProps {
  label: React.ReactNode;
  /** Secondary line under the label: what the control does, or its state. */
  hint?: React.ReactNode;
  /** The control, kept to the right edge. */
  children: React.ReactNode;
}

/**
 * One row of Settings: what it is on the left, the control on the right.
 *
 * The layout Appearance and Discord presence already had through `Toggle`, now
 * shared with every other section. `Toggle` reads its metrics from this
 * stylesheet rather than repeating them, so a switch and a button in the same
 * dialog line up exactly — and stay lined up when one of them is changed.
 */
export function SettingRow({ label, hint, children }: SettingRowProps): React.JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
      <div className={styles.control}>{children}</div>
    </div>
  );
}
