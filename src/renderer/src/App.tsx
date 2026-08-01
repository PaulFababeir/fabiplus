import { useCallback, useEffect, useState } from 'react';

import { toMovieUrl } from '@shared/media-url';
import type { EnrichmentProgress, EnrichmentSummary, LibraryCatalog } from '@shared/types';

/**
 * Phase 1 working shell. Real enough to run a scan, store a TMDB key and
 * pull metadata; the designed UI (top bar, Continue Watching, genre pills,
 * poster grid, sidebar) replaces this next.
 */
export default function App(): React.JSX.Element {
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [progress, setProgress] = useState<EnrichmentProgress | null>(null);
  const [summary, setSummary] = useState<EnrichmentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const config = await window.api.getConfig();
        setHasKey(config.tmdbApiKey !== null);
        const stored = await window.api.getLibrary();
        setCatalog(stored.items.length > 0 ? stored : await window.api.scanLibrary());
      } catch (err) {
        fail(err);
      }
    })();
  }, [fail]);

  useEffect(() => window.api.onEnrichProgress(setProgress), []);

  const saveKey = async (): Promise<void> => {
    try {
      const config = await window.api.setTmdbKey(keyInput);
      setHasKey(config.tmdbApiKey !== null);
      setKeyInput('');
    } catch (err) {
      fail(err);
    }
  };

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const rescan = (): Promise<void> => run(async () => setCatalog(await window.api.scanLibrary()));

  const enrich = (force: boolean): Promise<void> =>
    run(async () => {
      const result = await window.api.enrichLibrary(force);
      setSummary(result);
      setCatalog(await window.api.getLibrary());
      if (result.fatalError) setError(result.fatalError);
    });

  const items = catalog?.items ?? [];
  const enriched = items.filter((i) => i.metadata !== null).length;

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <header
        className="titlebar-drag"
        style={{
          height: 'var(--topbar-height)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--gutter)',
          color: 'var(--text-muted)',
          fontSize: 12
        }}
      >
        Movie Library
      </header>

      <main style={{ padding: '8px var(--gutter) 48px' }}>
        <section
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: 16,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 20
          }}
        >
          {!hasKey && (
            <>
              <input
                type="password"
                value={keyInput}
                placeholder="Paste TMDB API key or v4 token"
                onChange={(e) => setKeyInput(e.target.value)}
                style={{
                  flex: '1 1 320px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--control)',
                  color: 'var(--text)'
                }}
              />
              <button type="button" onClick={() => void saveKey()} disabled={!keyInput.trim()}>
                Save key
              </button>
            </>
          )}

          {hasKey && <span style={{ color: 'var(--text-muted)' }}>TMDB key saved ✓</span>}

          <button type="button" onClick={() => void rescan()} disabled={busy}>
            Rescan library
          </button>
          <button type="button" onClick={() => void enrich(false)} disabled={busy || !hasKey}>
            Fetch metadata
          </button>
          <button type="button" onClick={() => void enrich(true)} disabled={busy || !hasKey}>
            Refetch all
          </button>
        </section>

        {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}

        {progress && (
          <p style={{ color: 'var(--text-muted)' }}>
            {progress.done}/{progress.total} · {progress.current} · {progress.matched} matched ·{' '}
            {progress.needsReview} to review · {progress.failed} failed
          </p>
        )}

        {summary && !progress && (
          <p style={{ color: 'var(--text-muted)' }}>
            Done in {(summary.durationMs / 1000).toFixed(1)}s · {summary.matched} matched ·{' '}
            {summary.needsReview} need review · {summary.failed} failed
          </p>
        )}

        <p style={{ color: 'var(--text-muted)' }}>
          {items.length} titles · {enriched} with metadata
        </p>

        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 20
          }}
        >
          {items.map((item) => {
            const poster = item.metadata?.posters[0];
            const lowConfidence = item.match !== null && item.match.confidence < 0.75;

            return (
              <li key={item.id}>
                <div
                  style={{
                    aspectRatio: 'var(--poster-ratio)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    background: 'var(--surface)',
                    border: lowConfidence ? '2px solid #d9a441' : '1px solid var(--border)'
                  }}
                >
                  {poster && (
                    <img
                      src={toMovieUrl(poster.localPath)}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600 }}>
                  {item.metadata?.title ?? item.parsed.title}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {item.metadata?.year ?? item.parsed.year ?? '—'}
                  {lowConfidence && ' · check match'}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
