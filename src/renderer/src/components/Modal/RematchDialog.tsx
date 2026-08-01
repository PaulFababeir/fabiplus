import { useEffect, useState } from 'react';

import type { LibraryItem, ReviewCandidate } from '@shared/types';
import { AUTO_ACCEPT_UI } from '@renderer/lib/constants';
import { needsReviewItems } from '@renderer/lib/selectors';
import { useLibrary } from '@renderer/state/useLibrary';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './Modal.module.css';

/**
 * Fixes matches the scorer got wrong. The list is derived from the stored
 * catalog rather than the last enrichment run, so a bad match stays fixable
 * across restarts. Picking a candidate pins that provider id permanently.
 */
export function RematchDialog(): React.JSX.Element {
  const setRematchOpen = useUi((s) => s.setRematchOpen);
  const { catalog, busy, rematch } = useLibrary();

  const pending = needsReviewItems(catalog?.items ?? [], AUTO_ACCEPT_UI);
  const close = (): void => setRematchOpen(false);

  return (
    <div className={styles.scrim} onMouseDown={close} data-interactive>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Confirm matches"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 className={styles.heading}>
            Confirm matches{pending.length > 0 && ` (${pending.length})`}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className={styles.body}>
          {pending.length === 0 ? (
            <p className={styles.emptyReview}>Every film has a confident match.</p>
          ) : (
            pending.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                busy={busy}
                onPick={(remoteId) => void rematch(item.id, remoteId)}
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
  onPick: (remoteId: number) => void;
}

function ReviewRow({ item, busy, onPick }: ReviewRowProps): React.JSX.Element {
  const [query, setQuery] = useState(item.parsed.searchTitle);
  const [results, setResults] = useState<ReviewCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  // Seed with a search on the parsed title so the common case needs no typing.
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    window.api
      .searchProvider(item.parsed.searchTitle, item.parsed.year)
      .then((found) => {
        if (!cancelled) setResults(found);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.parsed.searchTitle, item.parsed.year]);

  const runSearch = async (): Promise<void> => {
    setSearching(true);
    try {
      // Drop the year filter on a manual search — the folder's year is often
      // exactly what was wrong.
      setResults(await window.api.searchProvider(query, null));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className={styles.reviewItem}>
      <div className={styles.reviewHead}>
        {item.metadata ? `Currently: ${item.metadata.title}` : 'No match found'}
        <div className={styles.reviewFolder}>{item.folderName}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          className={styles.input}
          value={query}
          placeholder="Search by title"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch();
          }}
        />
        <button
          type="button"
          className={styles.button}
          disabled={searching || !query.trim()}
          onClick={() => void runSearch()}
        >
          Search
        </button>
      </div>

      {searching && <p className={styles.note} style={{ marginTop: 0 }}>Searching…</p>}

      {!searching && results.length === 0 && (
        <p className={styles.note} style={{ marginTop: 0 }}>
          No results. Try the film&apos;s real title — the folder name may be misspelled.
        </p>
      )}

      {results.map((candidate) => (
        <button
          key={candidate.remoteId}
          type="button"
          className={styles.candidate}
          disabled={busy}
          onClick={() => onPick(candidate.remoteId)}
        >
          <span>{candidate.title}</span>
          <span className={styles.candidateYear}>{candidate.year ?? '—'}</span>
          <span className={styles.score}>{Math.round(candidate.score * 100)}%</span>
        </button>
      ))}
    </div>
  );
}
