import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './HoldButton.module.css';

/**
 * How long a hold must last. Long enough that nothing fires by accident, short
 * enough that a deliberate press does not feel like waiting.
 */
export const HOLD_MS = 2000;

/**
 * How long the completed fill lingers before draining. Without it the fill
 * empties the instant it fills, and a finished hold looks like a cancelled one.
 */
const SETTLE_MS = 280;

type Phase = 'idle' | 'holding' | 'done';

interface HoldButtonProps {
  /** Runs once the hold completes — never on a plain click. */
  onConfirm: () => void;
  /** `danger` fills red for the irreversible; `accent` fills the app's green. */
  tone: 'danger' | 'accent';
  children: React.ReactNode;
  /** The control's own look. This component adds only the fill and the timing. */
  className?: string;
  disabled?: boolean;
  /** Accessible name, for a button whose visible content is only an icon. */
  label?: string;
  /** Id of a visible description — a tooltip — read out alongside the name. */
  describedBy?: string;
  duration?: number;
}

/**
 * A button that acts only when held, for actions worth a moment's thought.
 *
 * It replaces confirm dialogs on the irreversible ones: a dialog is a second
 * click, which is exactly the motion an accidental first click is made of.
 * Holding gives the user the whole duration to change their mind — letting go,
 * or sliding off the button, cancels, and the fill drains back to show it.
 *
 * The fill is driven by a CSS transition rather than a frame loop. The timer
 * and the transition start in the same event, so they finish together, and a
 * transition reversed mid-flight drains from wherever it had got to without
 * any bookkeeping here.
 */
export function HoldButton({
  onConfirm,
  tone,
  children,
  className,
  disabled = false,
  label,
  describedBy,
  duration = HOLD_MS
}: HoldButtonProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  // The handlers below read the phase synchronously, inside the same event that
  // may already have changed it; state alone would hand them the stale value.
  const phaseRef = useRef<Phase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef(onConfirm);

  useEffect(() => {
    confirmRef.current = onConfirm;
  }, [onConfirm]);

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Letting go early. A completed hold has already acted, so it is left alone. */
  const cancel = useCallback(() => {
    if (phaseRef.current !== 'holding') return;
    clearTimer();
    go('idle');
  }, [clearTimer, go]);

  const start = useCallback(() => {
    if (disabled || phaseRef.current !== 'idle') return;
    go('holding');
    timer.current = setTimeout(() => {
      go('done');
      confirmRef.current();
      timer.current = setTimeout(() => {
        timer.current = null;
        go('idle');
      }, SETTLE_MS);
    }, duration);
  }, [disabled, duration, go]);

  // A button removed mid-hold — Remove key unmounts itself on success — must
  // not leave a timer behind to fire into a component that no longer exists.
  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  /*
   * Switching windows mid-hold never delivers the pointerup, so without this
   * the timer would run out and fire an action the user had walked away from.
   */
  useEffect(() => {
    if (phase !== 'holding') return;
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [phase, cancel]);

  return (
    <button
      type="button"
      className={`${styles.hold} ${className ?? ''}`}
      data-tone={tone}
      data-phase={phase}
      style={{ '--hold-ms': `${duration}ms` } as React.CSSProperties}
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={cancel}
      // Sliding off the button is the other way to change your mind.
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        // Also stops Enter's implicit click and Space scrolling the dialog.
        e.preventDefault();
        // A held key repeats; only the first press starts the hold.
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') cancel();
      }}
      onBlur={cancel}
      // A long press is what opens the context menu on touch.
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className={styles.fill} aria-hidden="true" />
      {children}
    </button>
  );
}
