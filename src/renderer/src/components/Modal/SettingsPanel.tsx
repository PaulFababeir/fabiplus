import { useEffect, useState } from 'react';

import type { UpdateStatus } from '@shared/types';

import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import { Toggle } from '@renderer/components/ui/Toggle';
import styles from './Modal.module.css';

/** Library maintenance: the TMDB key, rescanning, and metadata refresh. */
export function SettingsPanel(): React.JSX.Element {
  const { toggleSettings, translucent, setTranslucent } = useUi();
  const { busy, error, progress, summary, rescan, enrich, fetchNew } = useLibrary();
  const { state: profileState, clearProgress } = useProfile();

  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [version, setVersion] = useState('');
  const [discordOn, setDiscordOn] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void window.api.getConfig().then((config) => setHasKey(config.tmdbApiKey !== null));
    void window.api.getAppVersion().then(setVersion);
    void window.api.getConfig().then((config) => {
      setDiscordOn(config.discordPresence);
      setDiscordId(config.discordAppId ?? '');
    });
  }, []);

  const saveDiscord = async (enabled: boolean, appId: string): Promise<void> => {
    setDiscordOn(enabled);
    await window.api.setDiscordConfig(enabled, appId.trim() || null);
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

          <Toggle
            checked={translucent}
            label="Translucent window"
            hint="Blurs the desktop behind the app (Windows 11 acrylic). If nothing changes, check Windows Settings → Personalisation → Colours → Transparency effects."
            onChange={(next) => {
              setTranslucent(next);
              void window.api.setTranslucent(next);
            }}
          />

          <p className={styles.note}>
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

          <label className={styles.label}>Discord presence</label>

          <input
            className={styles.input}
            value={discordId}
            placeholder="Discord application ID"
            onChange={(e) => setDiscordId(e.target.value.replace(/\D/g, ''))}
            onBlur={() => void saveDiscord(discordOn, discordId)}
          />

          <Toggle
            checked={discordOn}
            disabled={!discordId.trim()}
            label="Show what I'm watching"
            hint="Puts the current film on your Discord profile with a countdown, and clears when you stop. Visible to anyone who can see your profile."
            onChange={(next) => void saveDiscord(next, discordId)}
          />

          <p className={styles.note}>
            Needs an application ID from discord.com/developers — the name you give it there is
            what Discord displays. Discord must be running as a desktop app.
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
        {(progress || (summary && busy)) && (
          <div className={styles.footer}>
            <div className={styles.progressRow}>
              <span className={styles.progressLabel}>
                {progress ? progress.current : 'Working…'}
              </span>
              <span className={styles.progressCount}>
                {progress ? `${progress.done}/${progress.total}` : ''}
              </span>
            </div>
            <div className={styles.bar}>
              <div className={styles.barFill} style={{ width: `${percent}%` }} />
            </div>
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
