import { useEffect, useState } from 'react';

import type { ScanResult } from '@shared/types';

/**
 * Phase 1 checkpoint shell: proves config → scan → IPC → render works against
 * the real library. The designed UI (top bar, Continue Watching, genre pills,
 * poster grid, sidebar) replaces this next.
 */
export default function App(): React.JSX.Element {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .scanLibrary()
      .then(setResult)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

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
        {error && <p style={{ color: '#ff6b6b' }}>Scan failed: {error}</p>}
        {!result && !error && <p style={{ color: 'var(--text-muted)' }}>Scanning library…</p>}

        {result && (
          <>
            <p style={{ color: 'var(--text-muted)' }}>
              {result.items.length} titles · scanned in {result.durationMs} ms
              {result.issues.length > 0 && ` · ${result.issues.length} issues`}
            </p>

            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 16
              }}
            >
              {result.items.map((item) => (
                <li
                  key={item.id}
                  style={{
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius-md)',
                    padding: 12
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.parsed.title}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {item.parsed.year ?? '—'} · {item.parsed.tags.resolution ?? '?'} ·{' '}
                    {item.video.ext}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
