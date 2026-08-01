import { useEffect, useMemo } from 'react';

import { ContinueWatching } from '@renderer/components/ContinueWatching/ContinueWatching';
import { FilterRow } from '@renderer/components/FilterRow/FilterRow';
import { MovieGrid } from '@renderer/components/Grid/MovieGrid';
import { RematchDialog } from '@renderer/components/Modal/RematchDialog';
import { SettingsPanel } from '@renderer/components/Modal/SettingsPanel';
import { BackdropLayer, Sidebar } from '@renderer/components/Sidebar/Sidebar';
import { TopBar } from '@renderer/components/TopBar/TopBar';
import { AUTO_ACCEPT_UI } from '@renderer/lib/constants';
import { filterAndSort, genresOf, needsReviewItems } from '@renderer/lib/selectors';
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
    setSidebarOpen,
    setRematchOpen
  } = useUi();

  useEffect(() => {
    void load();
    void loadProfiles();
  }, [load, loadProfiles]);

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

  /**
   * Clicking empty space collapses the sidebar. Anything meaningful carries
   * `data-interactive`, so this only fires on genuine background clicks.
   */
  const onBackgroundClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!sidebarOpen) return;
    if ((event.target as HTMLElement).closest('[data-interactive]')) return;
    setSidebarOpen(false);
  };

  const pendingReview = useMemo(
    () => needsReviewItems(items, AUTO_ACCEPT_UI).length,
    [items]
  );

  return (
    <div className={styles.app} onClick={onBackgroundClick}>
      <BackdropLayer item={sidebarOpen ? selected : null} />

      <TopBar />

      <div className={styles.body}>
        <main className={styles.content}>
          {error && <p className={styles.error}>{error}</p>}

          {pendingReview > 0 && (
            <div className={styles.reviewBanner} data-interactive>
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

      {settingsOpen && <SettingsPanel />}
      {rematchOpen && <RematchDialog />}
    </div>
  );
}
