import { useEffect, useState } from 'react';

import type { UpdateStatus } from '@shared/types';

import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import { HoldButton } from '@renderer/components/ui/HoldButton';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import { SettingRow } from '@renderer/components/ui/SettingRow';
import { Toggle } from '@renderer/components/ui/Toggle';
import styles from './Modal.module.css';

interface FolderSectionProps {
  label: string;
  /** Shown instead of the list when nothing is configured yet. */
  empty: string;
  paths: string[];
  busy: boolean;
  onAdd: () => void;
  onRemove: (path: string) => void;
}

/** One editable list of library roots. Films and shows each get one. */
function FolderSection({
  label,
  empty,
  paths,
  busy,
  onAdd,
  onRemove
}: FolderSectionProps): React.JSX.Element {
  return (
    <>
      <label className={styles.label}>{label}</label>

      {paths.length === 0 ? (
        <p className={styles.note}>{empty}</p>
      ) : (
        <ul className={styles.rootList}>
          {paths.map((path) => (
            <li key={path} className={styles.rootRow}>
              <span className={styles.rootPath} title={path}>
                {path}
              </span>
              <IconButton
                icon="close"
                label={`Remove ${path}`}
                size="sm"
                disabled={busy}
                onClick={() => onRemove(path)}
              />
            </li>
          ))}
        </ul>
      )}

      {/*
        The full width of the list it adds to, so it reads as the list's next
        slot rather than a stray button parked at the left edge. The call to
        action while the list is empty; quiet once there is something above it.
      */}
      <button
        type="button"
        className={`${styles.button} ${styles.addFolder} ${paths.length === 0 ? styles.primary : ''}`}
        disabled={busy}
        onClick={onAdd}
      >
        <Icon name="plus" size={14} />
        Add folder…
      </button>
    </>
  );
}

/**
 * Library maintenance: folders, the TMDB key, rescans and metadata refresh.
 *
 * Every section is the same shape now — what a thing is and does on the left,
 * the control hugging the right — matching the Appearance and Discord rows,
 * which were the only ones laid out that way before.
 */
export function SettingsPanel(): React.JSX.Element {
  const { toggleSettings, translucent, setTranslucent, bumpPresence } = useUi();
  // Field by field: the dialog stays open through a task now, and a
  // whole-store subscription would redraw all of it on every progress event.
  const busy = useLibrary((s) => s.busy);
  const error = useLibrary((s) => s.error);
  const rescan = useLibrary((s) => s.rescan);
  const enrich = useLibrary((s) => s.enrich);
  const fetchNew = useLibrary((s) => s.fetchNew);
  const { state: profileState, clearProgress } = useProfile();

  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [clearing, setClearing] = useState(false);
  const [version, setVersion] = useState('');
  const [discordOn, setDiscordOn] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);
  const [seriesRoots, setSeriesRoots] = useState<string[]>([]);

  useEffect(() => {
    void window.api.getConfig().then((config) => setHasKey(config.hasTmdbKey));
    void window.api.getAppVersion().then(setVersion);
    void window.api.getConfig().then((config) => {
      setDiscordOn(config.discordPresence);
      setRoots(config.movieRoots);
      setSeriesRoots(config.seriesRoots);
    });
  }, []);

  /**
   * Adding a folder rescans straight away — the alternative is a library that
   * stays empty until the user finds the Rescan button, which reads as broken.
   */
  const addRoot = async (kind: 'movie' | 'series'): Promise<void> => {
    const current = kind === 'movie' ? roots : seriesRoots;
    const picked = await window.api.pickFolder();
    if (picked === null || current.includes(picked)) return;
    await applyRoots(kind, [...current, picked]);
  };

  const removeRoot = async (kind: 'movie' | 'series', path: string): Promise<void> => {
    const current = kind === 'movie' ? roots : seriesRoots;
    await applyRoots(kind, current.filter((r) => r !== path));
  };

  const applyRoots = async (kind: 'movie' | 'series', next: string[]): Promise<void> => {
    if (kind === 'movie') {
      setRoots(next);
      await window.api.setMovieRoots(next);
    } else {
      setSeriesRoots(next);
      await window.api.setSeriesRoots(next);
    }
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
    if (!keyDraft.trim()) return;
    const config = await window.api.setTmdbKey(keyDraft);
    setHasKey(config.hasTmdbKey);
    setKeyDraft('');
  };

  const clearKey = async (): Promise<void> => {
    await window.api.setTmdbKey(null);
    setHasKey(false);
  };

  const watched = Object.keys(profileState?.watch ?? {}).length;

  /**
   * Wipes this profile's watch history. Irreversible, so it is held rather than
   * clicked; `clearing` stops a second hold starting another pass over entries
   * the first is still removing.
   */
  const clearHistory = async (): Promise<void> => {
    setClearing(true);
    try {
      for (const movieId of Object.keys(profileState?.watch ?? {})) {
        await clearProgress(movieId);
      }
    } finally {
      setClearing(false);
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
          <IconButton icon="close" label="Close" onClick={toggleSettings} />
        </div>

        {/*
          No progress footer any more. Library work reports to the card at the
          bottom right of the window, which stays up after this dialog closes —
          so starting a refetch no longer means sitting in front of a modal
          until it is done.
        */}
        <div className={styles.body}>
          <FolderSection
            label="Movie folders"
            empty="No folders yet. Add the folder holding your films — each film in its own subfolder — and it will be scanned straight away."
            paths={roots}
            busy={busy}
            onAdd={() => void addRoot('movie')}
            onRemove={(path) => void removeRoot('movie', path)}
          />

          <div className={styles.divider} />

          <FolderSection
            label="Series folders"
            empty="No folders yet. Add the folder holding your shows — one subfolder per show, with a folder per season inside it."
            paths={seriesRoots}
            busy={busy}
            onAdd={() => void addRoot('series')}
            onRemove={(path) => void removeRoot('series', path)}
          />

          <div className={styles.divider} />

          <label className={styles.label}>TMDB</label>

          <SettingRow
            label="API key"
            hint={
              hasKey
                ? 'A key is saved. Hold the button to remove it.'
                : 'A free key from themoviedb.org — a v3 API key or a v4 read token.'
            }
          >
            {hasKey ? (
              <HoldButton tone="danger" className={styles.button} onConfirm={() => void clearKey()}>
                Remove key
              </HoldButton>
            ) : (
              <>
                <input
                  className={`${styles.input} ${styles.keyInput}`}
                  type="password"
                  value={keyDraft}
                  placeholder="Paste your key"
                  aria-label="TMDB API key"
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveKey();
                  }}
                />
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={!keyDraft.trim()}
                  onClick={() => void saveKey()}
                >
                  Save
                </button>
              </>
            )}
          </SettingRow>

          <p className={styles.note}>
            Stored in config.json under your app data folder — never in the project. It is used
            only to fetch metadata and artwork, which are cached locally so the app runs offline
            afterwards.
          </p>

          <div className={styles.divider} />

          <label className={styles.label}>Library</label>

          <SettingRow
            label="Check for new films"
            hint={
              hasKey
                ? 'Rescans, then looks up only the titles that were not in the catalog before — one new film costs one lookup, not a pass over the whole library.'
                : 'Needs a TMDB key. The quick check in the top bar still finds new folders without one, under the names parsed from them.'
            }
          >
            <button
              type="button"
              className={`${styles.button} ${styles.primary} ${styles.rowAction}`}
              disabled={busy || !hasKey}
              onClick={() => void fetchNew()}
            >
              Check
            </button>
          </SettingRow>

          <SettingRow
            label="Rescan library"
            hint="Re-reads your folders for films added, moved or removed. Nothing is looked up online."
          >
            <button
              type="button"
              className={`${styles.button} ${styles.rowAction}`}
              disabled={busy}
              onClick={() => void rescan()}
            >
              Rescan
            </button>
          </SettingRow>

          <SettingRow
            label="Fetch missing metadata"
            hint="Looks up details and artwork for titles that have none yet."
          >
            <button
              type="button"
              className={`${styles.button} ${styles.rowAction}`}
              disabled={busy || !hasKey}
              onClick={() => void enrich(false)}
            >
              Fetch
            </button>
          </SettingRow>

          <SettingRow
            label="Refetch all"
            hint="Downloads details and artwork again for every title. Slow — for when the library looks out of date."
          >
            <button
              type="button"
              className={`${styles.button} ${styles.rowAction}`}
              disabled={busy || !hasKey}
              onClick={() => void enrich(true)}
            >
              Refetch
            </button>
          </SettingRow>

          {watched > 0 && (
            <>
              {/*
                The full width, unlike the rows above: it is the one action here
                that destroys something that cannot be regenerated, and it
                should not look like a peer of Rescan. Held rather than clicked —
                the old flow was a click then a second "Clear" click, which is
                the same motion an accidental double click is made of.
              */}
              <HoldButton
                tone="danger"
                className={`${styles.button} ${styles.wide}`}
                disabled={clearing}
                onConfirm={() => void clearHistory()}
              >
                Hold to clear watch history · {watched} {watched === 1 ? 'entry' : 'entries'}
              </HoldButton>
              <p className={styles.note}>
                Only this profile&apos;s progress, for every film and episode. This cannot be undone.
              </p>
            </>
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

          <SettingRow
            label={`Version ${version || '…'}`}
            hint={update ? updateMessage(update) : 'Updates are checked only when you ask.'}
          >
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
          </SettingRow>

          <p className={styles.note}>
            Nothing is checked automatically — this is the only thing here that reaches the
            network besides metadata. Windows cannot replace a running program, so an update
            downloads now and installs when you next close the app.
          </p>

          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
