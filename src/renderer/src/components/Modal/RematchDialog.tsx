import { useCallback, useEffect, useRef, useState } from 'react';

import type { LibraryItem, ReviewCandidate } from '@shared/types';
import { AUTO_ACCEPT } from '@shared/constants';
import { displayTitle, needsReviewItems } from '@renderer/lib/selectors';
import { useLibrary } from '@renderer/state/useLibrary';
import { useOnEscape } from '@renderer/lib/useDismiss';
import { useUi } from '@renderer/state/useUi';
import { IconButton } from '@renderer/components/ui/IconButton';
import styles from './Modal.module.css';

/**
 * Fixes matches the scorer got wrong.
 *
 * Opened from the sidebar it targets one film — including a confidently but
 * wrongly matched one, which never appears in the review list. Opened from the
 * review banner it lists everything still outstanding.
 */
export function RematchDialog(): React.JSX.Element {
  const { rematchTargetId, setRematchOpen } = useUi();
  const { catalog, busy, rematch } = useLibrary();

  const items = catalog?.items ?? [];
  const target = rematchTargetId ? items.find((i) => i.id === rematchTargetId) : undefined;
  const listed = target ? [target] : needsReviewItems(items, AUTO_ACCEPT);

  const close = useCallback(() => setRematchOpen(false), [setRematchOpen]);
  useOnEscape(close);

  return (
    <div className={styles.scrim} onMouseDown={close}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Fix match"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 className={styles.heading}>
            {target ? `Fix match — ${displayTitle(target)}` : `Confirm matches (${listed.length})`}
          </h2>
          <IconButton icon="close" label="Close" onClick={close} />
        </div>

        <div className={styles.body}>
          {listed.length === 0 ? (
            <p className={styles.emptyReview}>Every film has a confident match.</p>
          ) : (
            listed.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                busy={busy}
                soloed={target !== undefined}
                onPick={(remoteId) => {
                  void rematch(item.id, remoteId);
                  if (target) close();
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface ReviewRowProps {
  item: LibraryItem;
  busy: boolean;
  soloed: boolean;
  onPick: (remoteId: number) => void;
}

function ReviewRow({ item, busy, soloed, onPick }: ReviewRowProps): React.JSX.Element {
  const [query, setQuery] = useState(item.parsed.searchTitle);
  const [year, setYear] = useState<string>(item.parsed.year ? String(item.parsed.year) : '');
  const [results, setResults] = useState<ReviewCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = async (title: string, withYear: number | null): Promise<void> => {
    setSearching(true);
    setError(null);
    try {
      setResults(await window.api.searchProvider(title, withYear));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  // Seed with the parsed title so the common case needs no typing.
  useEffect(() => {
    void runSearch(item.parsed.searchTitle, item.parsed.year);
    if (soloed) inputRef.current?.focus();
    // Keyed on the film alone on purpose. Including `query` here would fire a
    // provider request on every keystroke; searching is explicit.
  }, [item.id]);

  const currentRemoteId = item.metadata?.remoteId ?? null;

  return (
    <div className={styles.reviewItem}>
      <div className={styles.reviewHead}>
        {item.metadata ? `Currently matched to: ${item.metadata.title}` : 'No match yet'}
        <div className={styles.reviewFolder}>{item.folderName}</div>
      </div>

      <div className={styles.searchRow}>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder="Film title"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch(query, year ? Number(year) : null);
          }}
        />
        <input
          className={`${styles.input} ${styles.yearInput}`}
          value={year}
          placeholder="Year"
          inputMode="numeric"
          maxLength={4}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch(query, year ? Number(year) : null);
          }}
        />
        <button
          type="button"
          className={styles.button}
          disabled={searching || !query.trim()}
          onClick={() => void runSearch(query, year ? Number(year) : null)}
        >
          Search
        </button>
      </div>

      {searching && <p className={styles.note}>Searching…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!searching && !error && results.length === 0 && (
        <p className={styles.note}>
          No results. Try the film&apos;s real title, or clear the year — release folders often
          carry the wrong one.
        </p>
      )}

      {!searching &&
        results.map((candidate) => (
          <button
            key={candidate.remoteId}
            type="button"
            className={styles.candidate}
            data-current={candidate.remoteId === currentRemoteId}
            disabled={busy}
            onClick={() => onPick(candidate.remoteId)}
          >
            <span className={styles.candidateThumb}>
              {candidate.posterUrl && <img src={candidate.posterUrl} alt="" loading="lazy" />}
            </span>

            <span className={styles.candidateBody}>
              <span className={styles.candidateTitle}>
                {candidate.title}
                <span className={styles.candidateYear}>{candidate.year ?? '—'}</span>
                {candidate.remoteId === currentRemoteId && (
                  <span className={styles.currentBadge}>current</span>
                )}
              </span>
              {candidate.overview && (
                <span className={styles.candidateOverview}>{candidate.overview}</span>
              )}
            </span>

            <span className={styles.score}>{Math.round(candidate.score * 100)}%</span>
          </button>
        ))}
    </div>
  );
}
