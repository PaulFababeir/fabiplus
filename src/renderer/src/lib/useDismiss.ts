import { useEffect, type RefObject } from 'react';

/**
 * Dismissal effects shared by every popover, menu and dialog.
 *
 * Six components had hand-rolled versions of these, each subtly different —
 * some listened on `mousedown`, some on `click`, some forgot to unbind. One
 * implementation means one behaviour and one place to fix it.
 */

/** Runs `onEscape` while `active`. */
export function useOnEscape(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;

    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEscape();
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape, active]);
}

/**
 * Runs `onOutside` when a press lands outside `ref` while `active`.
 *
 * Bound to `mousedown` rather than `click` deliberately: it fires before the
 * click, so a handler underneath can tell the gesture merely dismissed
 * something and decline to act on it.
 */
export function useOnClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: (event: MouseEvent) => void,
  active = true
): void {
  useEffect(() => {
    if (!active) return;

    const handler = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return;
      onOutside(event);
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside, active]);
}
