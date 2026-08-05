import { useEffect, useState } from 'react';

import type { UpdateStatus } from '@shared/types';

import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { IconButton } from '@renderer/components/ui/IconButton';
import { Toggle } from '@renderer/components/ui/Toggle';
import styles from './Modal.module.css';

/** Library maintenance: the TMDB key, rescanning, and metadata refresh. */
export function SettingsPanel(): React.JSX.Element {
  const { toggleSettings, translucent, setTranslucent, bumpPresence } = useUi();
  const { busy, error, progress, summary, rescan, enrich, fetchNew } = useLibrary();
  const { state: profileState, clearProgress } = useProfile();

  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [version, setVersion] = useState('');
  const [discordOn, setDiscordOn] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);

  useEffect(() => {
    void window.api.getConfig().then((config) => setHasKey(config.tmdbApiKey !== null));
    void window.api.getAppVersion().then(setVersion);
    void window.api.getConfig().then((config) => {
      setDiscordOn(config.discordPresence);
      setRoots(config.movieRoots);
    });
  }, []);

  /**
   * Adding a folder rescans straight away — the alternative is a library that
   * stays empty until the user finds the Rescan button, which reads as broken.
   */
  const addRoot = async (): Promise<void> => {
    const picked = await window.api.pickFolder();
    if (picked === null || roots.includes(picked)) return;

    const next = [...roots, picked];
    setRoots(next);
    await window.api.setMovieRoots(next);
    await rescan();
  };

  const removeRoot = async (path: string): Promise<void> => {
    const next = roots.filter((r) => r !== path);
    setRoots(next);
    await window.api.setMovieRoots(next);
    await rescan();
  };

  /**
   * The application ID is bundled (see DISCORD_APP_ID), so null is sent and
   * main falls back to it. Only an install that already stored an override
   * keeps one.
   */
  const saveDiscord = async (enabled: boolean): Promise<void> => {
    setDiscordOn(enabled);
    await window.api.setDiscordConfig(enabled, null);
    // The shell only republishes when the presence content changes, so nudge it
    // — otherwise switching this on shows nothing until you touch something.
    bumpPresence();
  };

  const runUpdateCheck = async (): Promise<void> => {
    setChecking(true);
    try {
      setUpdate(await window.api.checkForUpdate());
    } finally {
      setChecking(false);
    }
  };

  const runUpdateDownload = async (): Promise<void> => {
    setChecking(true);
    try {
      setUpdate(await window.api.downloadUpdate());
    } finally {
      setChecking(false);
    }
  };

  const updateMessage = (status: UpdateStatus): string => {
    switch (status.state) {
      case 'current':
        return 'You are on the latest version.';
      case 'available':
        return `Version ${status.detail} is available.`;
      case 'downloaded':
        return 'Downloaded. It installs the next time you close the app.';
      case 'unavailable':
        return status.detail ?? 'Updates are not available here.';
      default:
        return status.detail ?? 'The update check failed.';
    }
  };

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
          <IconButton icon="close" label="Close" onClick={toggleSettings} />
        </div>

        <div className={styles.body}>
          <label className={styles.label}>Movie folders</label>

          {roots.length === 0 ? (
            <p className={styles.note}>
              No folders yet. Add the folder holding your films — each film in its own
              subfolder — and it will be scanned straight away.
            </p>
          ) : (
            <ul className={styles.rootList}>
              {roots.map((root) => (
                <li key={root} className={styles.rootRow}>
                  <span className={styles.rootPath} title={root}>
                    {root}
                  </span>
                  <IconButton
                    icon="close"
                    label={`Remove ${root}`}
                    size="sm"
                    disabled={busy}
                    onClick={() => void removeRoot(root)}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.button} ${roots.length === 0 ? styles.primary : ''}`}
              disabled={busy}
              onClick={() => void addRoot()}
            >
              Add folder…
            </button>
          </div>

          <div className={styles.divider} />

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

          <div className={styles.divider} />

          <label className={styles.label}>Library</label>

          <p className={styles.note} style={{ marginTop: 0 }}>
            <strong>Check for new films</strong> rescans and then looks up only the titles that
            were not in the catalog before, so adding one film costs one lookup rather than a pass
            over the whole library.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy || !hasKey}
              onClick={() => void fetchNew()}
            >
              Check for new films
            </button>
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

          <div className={styles.divider} />

          <label className={styles.label}>Appearance</label>

          <Toggle
            checked={translucent}
            label="Translucent window"
            hint="Blurs the desktop behind the app (Windows 11 acrylic). If nothing changes, check Windows Settings → Personalisation → Colours → Transparency effects."
            onChange={(next) => {
              setTranslucent(next);
              void window.api.setTranslucent(next);
            }}
          />

          <div className={styles.divider} />

          <label className={styles.label}>Discord presence</label>

          <Toggle
            checked={discordOn}
            label="Show what I'm watching"
            hint="Puts the current film on your Discord profile with a countdown, and clears when you stop. Visible to anyone who can see your profile."
            onChange={(next) => void saveDiscord(next)}
          />

          <p className={styles.note}>
            Discord must be running as a desktop app. Nothing is sent to Discord&apos;s servers —
            this talks to the local client only, and stops the moment you switch it off.
          </p>

          <div className={styles.divider} />

          <label className={styles.label}>About</label>
          <div className={styles.actions} style={{ marginTop: 0 }}>
            <span style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
              Version {version || '…'}
            </span>
            <button
              type="button"
              className={styles.button}
              disabled={checking}
              onClick={() => void runUpdateCheck()}
            >
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
            {update?.state === 'available' && (
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                disabled={checking}
                onClick={() => void runUpdateDownload()}
              >
                Download
              </button>
            )}
          </div>

          {update && <p className={styles.note}>{updateMessage(update)}</p>}

          <p className={styles.note}>
            Nothing is checked automatically — this is the only thing here that reaches the
            network besides metadata. Windows cannot replace a running program, so an update
            downloads now and installs when you next close the app.
          </p>

          {error && <p className={styles.error}>{error}</p>}
        </div>

        {/*
          Outside the scrolling body on purpose. Sitting inside it, progress
          was pushed below the fold by the settings above and looked missing
          exactly when it mattered.
        */}
        {(busy || progress) && (
          <div className={styles.footer}>
            <div className={styles.progressRow}>
              <span className={styles.progressLabel}>
                {progress ? progress.current : 'Scanning library…'}
              </span>
              <span className={styles.progressCount}>
                {progress ? `${progress.done}/${progress.total}` : ''}
              </span>
            </div>
            {/*
              Indeterminate until the first progress event. Waiting for one left
              the footer hidden through the entire scan — the slow part — so the
              dialog looked frozen and then flashed a single film at the end.
            */}
            {progress ? (
              <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${percent}%` }} />
              </div>
            ) : (
              <div className={`${styles.bar} ${styles.barIndeterminate}`} />
            )}
          </div>
        )}

        {summary && !busy && (
          <div className={styles.footer}>
            <span className={styles.progressLabel}>
              {summary.total === 0
                ? 'No new films found.'
                : `${summary.total} processed in ${(summary.durationMs / 1000).toFixed(1)}s — ` +
                  `${summary.matched} matched, ${summary.needsReview} need review, ` +
                  `${summary.failed} failed.`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
