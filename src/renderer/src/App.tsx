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
import type { KindFilter } from '@shared/types';
import { filterAndSort, genresOf, matchesKind, needsReviewItems } from '@renderer/lib/selectors';
import { useDiscordPresence } from '@renderer/lib/useDiscordPresence';
import { useLibrary } from '@renderer/state/useLibrary';
import { useProfile } from '@renderer/state/useProfile';
import { useUi } from '@renderer/state/useUi';
import styles from './App.module.css';

/**
 * What an empty library says, per view. `all` cannot name a single kind, and
 * it is now the view a fresh install lands in, so it needed its own wording
 * rather than falling through to the films copy.
 */
const EMPTY_COPY: Record<KindFilter, { title: string; body: string }> = {
  all: {
    title: 'Nothing here yet',
    body: 'Choose the folders your films and shows live in — a film sits in its own subfolder, a show gets one folder per season.'
  },
  movie: {
    title: 'No films yet',
    body: 'Choose the folder your films live in — each one in its own subfolder — and they will be scanned and matched automatically.'
  },
  series: {
    title: 'No shows yet',
    body: 'Choose the folder your shows live in — one subfolder per show, with a folder per season inside it.'
  }
};

export default function App(): React.JSX.Element {
  const { catalog, loading, error, load, setProgress } = useLibrary();
  const { state: profileState, load: loadProfiles } = useProfile();
  const {
    kind,
    search,
    genre,
    sort,
    selectedId,
    sidebarOpen,
    settingsOpen,
    rematchOpen,
    playingId,
    playingEpisodeId,
    translucent,
    playback,
    presenceEpoch,
    setTranslucent,
    setRematchOpen,
    toggleSettings
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
  // Pills describe the view you are in, not the whole catalog.
  const ofKind = useMemo(() => items.filter((i) => matchesKind(i, kind)), [items, kind]);
  const genres = useMemo(() => genresOf(ofKind), [ofKind]);
  const visible = useMemo(
    () => filterAndSort({ items, kind, search, genre, sort }),
    [items, kind, search, genre, sort]
  );
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );
  const playing = useMemo(
    () => items.find((item) => item.id === playingId) ?? null,
    [items, playingId]
  );
  /**
   * The episode chosen in the sidebar, when one is playing. Progress is stored
   * against the episode id rather than the show, so each episode resumes where
   * it was left rather than sharing one position across the series.
   */
  const episode = useMemo(() => {
    if (!playing || playingEpisodeId === null) return null;
    return (
      (playing.seasons ?? []).flatMap((s) => s.episodes).find((e) => e.id === playingEpisodeId) ??
      null
    );
  }, [playing, playingEpisodeId]);

  const progressId = episode?.id ?? playing?.id ?? null;

  // Resume where this profile left off, unless it was finished.
  const resumeAt = useMemo(() => {
    if (progressId === null) return 0;
    const entry = profileState?.watch[progressId];
    return entry && !entry.finished ? entry.positionSec : 0;
  }, [progressId, profileState]);

  const pendingReview = useMemo(
    () => needsReviewItems(items, AUTO_ACCEPT).length,
    [items]
  );

  // Publishes whatever the app is doing — playing, paused, or browsing — so the
  // presence never falls back to Discord's bare detected-app line.
  useDiscordPresence({
    playing,
    episode,
    selected,
    playback,
    profile: profileState,
    libraryCount: items.length,
    epoch: presenceEpoch
  });

  return (
    <div className={styles.app}>
      <BackdropLayer item={sidebarOpen ? selected : null} profileState={profileState} />

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
          ) : ofKind.length === 0 ? (
            /* A fresh install scans nothing until a folder is chosen. Without
               this the grid is simply blank, which reads as a broken app. */
            <div className={styles.empty}>
              <h2 className={styles.emptyTitle}>
                {EMPTY_COPY[kind].title}
              </h2>
              <p className={styles.emptyBody}>
                {EMPTY_COPY[kind].body}
              </p>
              <button
                type="button"
                className={styles.emptyAction}
                onClick={() => toggleSettings()}
              >
                Choose a folder
              </button>
            </div>
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
        {playing && (
          <Player
            key={episode?.id ?? playing.id}
            item={playing}
            episode={episode}
            startAt={resumeAt}
          />
        )}
      </AnimatePresence>

      {settingsOpen && <SettingsPanel />}
      {rematchOpen && <RematchDialog />}
    </div>
  );
}
