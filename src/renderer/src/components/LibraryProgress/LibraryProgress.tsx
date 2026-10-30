import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { TASK_COPY, useLibrary } from '@renderer/state/useLibrary';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import styles from './LibraryProgress.module.css';

/** How long a successful result stays up. A failure stays until dismissed. */
const OUTCOME_MS = 6000;

interface LibraryProgressProps {
  /** Whether the sidebar is taking the right edge, which the card then clears. */
  sidebarOpen: boolean;
}

/**
 * Progress for library work, in a card that keeps out of the way.
 *
 * It used to live in the settings dialog's footer, which meant a rescan or a
 * metadata run held the whole window behind a modal until it finished. Here
 * the library stays usable throughout — that is the point of the card — and
 * the top bar's quick check, which has no dialog at all, has somewhere to
 * report to.
 *
 * Rendered at the app's root rather than inside the content column so it can
 * sit above the settings scrim: a task started from Settings is reported here
 * too, while the dialog is still open. The player is above it, deliberately —
 * a card over a film is a distraction, and the task keeps running underneath.
 */
export function LibraryProgress({ sidebarOpen }: LibraryProgressProps): React.JSX.Element {
  // The one component that should re-render per progress event — and only for
  // these fields, not for the catalog swap that ends every task.
  const task = useLibrary((s) => s.task);
  const outcome = useLibrary((s) => s.outcome);
  const progress = useLibrary((s) => s.progress);
  const dismissOutcome = useLibrary((s) => s.dismissOutcome);
  const [hovered, setHovered] = useState(false);

  // A result clears itself unless it is being read. A failure is left up, since
  // dismissing an error the user never saw is how failures go unnoticed.
  useEffect(() => {
    if (!outcome || outcome.failed || hovered) return;
    const id = setTimeout(dismissOutcome, OUTCOME_MS);
    return () => clearTimeout(id);
  }, [outcome, hovered, dismissOutcome]);

  const running = task !== null;
  const shown = task ?? outcome?.task ?? null;
  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <AnimatePresence>
      {shown && (
        <motion.section
          key="library-progress"
          className={styles.card}
          data-sidebar={sidebarOpen}
          data-failed={outcome?.failed === true}
          aria-label="Library activity"
          // motion owns transform; the sidebar offset rides on `right` instead,
          // in CSS, so the two never contend for the same property.
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className={styles.head}>
            {!running && (
              <Icon
                name={outcome?.failed ? 'info' : 'check'}
                size={14}
                className={styles.status}
              />
            )}
            {/*
              Only the heading and the result are live. The per-film line below
              changes several times a second during enrichment, and announcing
              every title would drown a screen reader.
            */}
            <span className={styles.title} aria-live="polite">
              {running
                ? `${TASK_COPY[shown].running}…`
                : outcome?.failed
                  ? TASK_COPY[shown].failed
                  : TASK_COPY[shown].done}
            </span>
            {!running && (
              <IconButton
                icon="close"
                label="Dismiss"
                size="sm"
                className={styles.dismiss}
                onClick={dismissOutcome}
              />
            )}
          </div>

          {running ? (
            <>
              <div className={styles.row}>
                <span className={styles.current}>
                  {progress ? progress.current : 'Scanning your folders…'}
                </span>
                {progress && (
                  <span className={styles.count}>
                    {progress.done}/{progress.total}
                  </span>
                )}
              </div>
              {/*
                Indeterminate until the first progress event. A scan emits none —
                it is one pass over the folder tree with nothing to count until it
                ends — and it is the slow half of a check for new films, so a bar
                parked at 0% reads as a stalled task.
              */}
              {progress ? (
                <div className={styles.bar}>
                  <div className={styles.barFill} style={{ width: `${percent}%` }} />
                </div>
              ) : (
                <div className={`${styles.bar} ${styles.barIndeterminate}`} />
              )}
            </>
          ) : (
            <p className={styles.message} aria-live="polite">
              {outcome?.message}
            </p>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
