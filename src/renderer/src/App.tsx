import { useEffect, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';

import { ContinueWatching } from '@renderer/components/ContinueWatching/ContinueWatching';
import { FilterRow } from '@renderer/components/FilterRow/FilterRow';
import { MovieGrid } from '@renderer/components/Grid/MovieGrid';
import { RematchDialog } from '@renderer/components/Modal/RematchDialog';
import { SettingsPanel } from '@renderer/components/Modal/SettingsPanel';
import { Player } from '@renderer/components/Player/Player';
import { BackdropLayer, Sidebar } from '@renderer/components/Sidebar/Sidebar';
import { TopBar } from '@renderer/components/TopBar/TopBar';
import { AUTO_ACCEPT } from '@shared/constants';
import { filterAndSort, genresOf, needsReviewItems } from '@renderer/lib/selectors';
import { useDiscordPresence } from '@renderer/lib/useDiscordPresence';
import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import styles from './App.module.css';

export default function App(): React.JSX.Element {
  const { catalog, loading, error, load, setProgress } = useLibrary();
  const { state: profileState, load: loadProfiles } = useProfile();
  const {
    search,
    genre,
    sort,
    selectedId,
    sidebarOpen,
    settingsOpen,
    rematchOpen,
    playingId,
    translucent,
    playback,
    presenceEpoch,
    setTranslucent,
    setRematchOpen
  } = useUi();

  useEffect(() => {
    void load();
    void loadProfiles();
    void window.api.getConfig().then((config) => setTranslucent(config.translucentBackground));
  }, [load, loadProfiles, setTranslucent]);

  // Drives --bg-veil, so the page lets the acrylic through only when enabled.
  useEffect(() => {
    document.documentElement.dataset['translucent'] = String(translucent);
  }, [translucent]);

  useEffect(() => window.api.onEnrichProgress(setProgress), [setProgress]);

  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const genres = useMemo(() => genresOf(items), [items]);
  const visible = useMemo(
    () => filterAndSort({ items, search, genre, sort }),
    [items, search, genre, sort]
  );
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );
  const playing = useMemo(
    () => items.find((item) => item.id === playingId) ?? null,
    [items, playingId]
  );
  // Resume where this profile left off, unless the film was finished.
  const resumeAt = useMemo(() => {
    if (!playing) return 0;
    const entry = profileState?.watch[playing.id];
    return entry && !entry.finished ? entry.positionSec : 0;
  }, [playing, profileState]);

  const pendingReview = useMemo(
    () => needsReviewItems(items, AUTO_ACCEPT).length,
    [items]
  );

  // Publishes whatever the app is doing — playing, paused, or browsing — so the
  // presence never falls back to Discord's bare detected-app line.
  useDiscordPresence({
    playing,
    selected,
    playback,
    profile: profileState,
    libraryCount: items.length,
    epoch: presenceEpoch
  });

  return (
    <div className={styles.app}>
      <BackdropLayer item={sidebarOpen ? selected : null} />

      <div className={`${styles.titlebarStrip} titlebar-drag`} />
      <TopBar />

      <div className={styles.body}>
        <main className={styles.content}>
          {error && <p className={styles.error}>{error}</p>}

          {pendingReview > 0 && (
            <div className={styles.reviewBanner}>
              <span>
                {pendingReview} {pendingReview === 1 ? 'film needs' : 'films need'} a match
                confirmed.
              </span>
              <button
                type="button"
                className={styles.reviewAction}
                onClick={() => setRematchOpen(true)}
              >
                Review
              </button>
            </div>
          )}

          {loading ? (
            <p className={styles.status}>Scanning library…</p>
          ) : (
            <>
              <ContinueWatching items={items} profileState={profileState} />
              <FilterRow genres={genres} />
              <MovieGrid items={visible} profileState={profileState} />
            </>
          )}
        </main>

        <Sidebar item={selected} profileState={profileState} />
      </div>

      <AnimatePresence>
        {playing && <Player key={playing.id} item={playing} startAt={resumeAt} />}
      </AnimatePresence>

      {settingsOpen && <SettingsPanel />}
      {rematchOpen && <RematchDialog />}
    </div>
  );
}
