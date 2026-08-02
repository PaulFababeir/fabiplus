import { useEffect, useState } from 'react';

import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './Modal.module.css';

/** Library maintenance: the TMDB key, rescanning, and metadata refresh. */
export function SettingsPanel(): React.JSX.Element {
  const { toggleSettings, translucent, setTranslucent } = useUi();
  const { catalog, busy, error, progress, summary, rescan, enrich } = useLibrary();
  const { state: profileState, setProgress, clearProgress } = useProfile();

  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  useEffect(() => {
    void window.api.getConfig().then((config) => setHasKey(config.tmdbApiKey !== null));
  }, []);

  const saveKey = async (): Promise<void> => {
    const config = await window.api.setTmdbKey(keyDraft);
    setHasKey(config.tmdbApiKey !== null);
    setKeyDraft('');
  };

  const clearKey = async (): Promise<void> => {
    await window.api.setTmdbKey(null);
    setHasKey(false);
  };

  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  /**
   * Fakes watch history across a spread of films so the Continue Watching deck
   * has something to render. Removed once the Phase 2 player exists.
   */
  const seedDemoProgress = async (): Promise<void> => {
    const picks = (catalog?.items ?? []).filter((item) => item.metadata?.backdrop).slice(0, 8);

    // Written in order, so each successive write carries a later timestamp and
    // the deck ends up ordered most-recent-first.
    for (const [i, item] of picks.entries()) {
      const runtimeSec = (item.metadata?.runtimeMin ?? 120) * 60;
      const fraction = 0.15 + ((i * 0.09) % 0.6);
      await setProgress(item.id, Math.round(runtimeSec * fraction), runtimeSec);
    }
  };

  const clearDemoProgress = async (): Promise<void> => {
    for (const movieId of Object.keys(profileState?.watch ?? {})) {
      await clearProgress(movieId);
    }
  };

  return (
    <div className={styles.scrim} onMouseDown={toggleSettings}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 className={styles.heading}>Settings</h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={toggleSettings}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.label} htmlFor="tmdb-key">
            TMDB API key
          </label>
          {hasKey ? (
            <div className={styles.actions} style={{ marginTop: 0 }}>
              <span style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
                A key is saved.
              </span>
              <button type="button" className={styles.button} onClick={() => void clearKey()}>
                Remove key
              </button>
            </div>
          ) : (
            <>
              <input
                id="tmdb-key"
                className={styles.input}
                type="password"
                value={keyDraft}
                placeholder="v3 API key or v4 read token"
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={!keyDraft.trim()}
                  onClick={() => void saveKey()}
                >
                  Save key
                </button>
              </div>
            </>
          )}

          <p className={styles.note}>
            Stored in config.json under your app data folder — never in the project. It is used
            only to fetch metadata and artwork, which are cached locally so the app runs offline
            afterwards.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              aria-pressed={translucent}
              onClick={() => {
                const next = !translucent;
                setTranslucent(next);
                void window.api.setTranslucent(next);
              }}
            >
              {translucent ? 'Translucent window: on' : 'Translucent window: off'}
            </button>
          </div>

          <p className={styles.note}>
            Blurs the desktop behind the window (Windows 11 acrylic). Applies straight away. Turn
            it off if it costs you readability or frame rate.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={() => void rescan()}
            >
              Rescan library
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={busy || !hasKey}
              onClick={() => void enrich(false)}
            >
              Fetch missing metadata
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={busy || !hasKey}
              onClick={() => void enrich(true)}
            >
              Refetch all
            </button>
          </div>

          {import.meta.env.DEV && (
            <>
              <p className={styles.note} style={{ marginBottom: 0 }}>
                Dev only — there is no player yet, so nothing can generate watch progress. This
                fakes some so the Continue Watching deck can be worked on.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => void seedDemoProgress()}
                >
                  Seed demo progress
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => void clearDemoProgress()}
                >
                  Clear progress
                </button>
              </div>
            </>
          )}

          {progress && (
            <div className={styles.progress}>
              {progress.done}/{progress.total} · {progress.current}
              <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}

          {summary && !progress && (
            <p className={styles.progress}>
              Finished in {(summary.durationMs / 1000).toFixed(1)}s — {summary.matched} matched,{' '}
              {summary.needsReview} need review, {summary.failed} failed.
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
