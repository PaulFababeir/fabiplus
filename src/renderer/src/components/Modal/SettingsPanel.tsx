import { useEffect, useState } from 'react';

import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import styles from './Modal.module.css';

/** Library maintenance: the TMDB key, rescanning, and metadata refresh. */
export function SettingsPanel(): React.JSX.Element {
  const { toggleSettings, translucent, setTranslucent } = useUi();
  const { busy, error, progress, summary, rescan, enrich } = useLibrary();
  const { state: profileState, clearProgress } = useProfile();

  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);

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

  const watched = Object.keys(profileState?.watch ?? {}).length;

  /** Wipes this profile's watch history. Irreversible, so it confirms first. */
  const clearHistory = async (): Promise<void> => {
    for (const movieId of Object.keys(profileState?.watch ?? {})) {
      await clearProgress(movieId);
    }
    setConfirmingClear(false);
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
            Blurs the desktop behind the window (Windows 11 acrylic). Applies straight away. If
            nothing changes, check Windows Settings → Personalisation → Colours → Transparency
            effects, which Electron follows.
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

          {watched > 0 && (
            <div className={styles.actions}>
              {confirmingClear ? (
                <>
                  <span style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
                    Clear {watched} {watched === 1 ? 'entry' : 'entries'}? This cannot be undone.
                  </span>
                  <button type="button" className={styles.button} onClick={() => void clearHistory()}>
                    Clear
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => setConfirmingClear(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setConfirmingClear(true)}
                >
                  Clear watch history
                </button>
              )}
            </div>
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
