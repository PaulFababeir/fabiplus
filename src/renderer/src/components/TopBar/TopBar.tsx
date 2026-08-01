import { useEffect, useState } from 'react';

import { useUi } from '@renderer/state/useUi';
import { Icon } from '@renderer/components/ui/Icon';
import { ProfileMenu } from './ProfileMenu';
import styles from './TopBar.module.css';

/** Debounce so a 79-item filter doesn't run on every keystroke. */
const SEARCH_DEBOUNCE_MS = 150;

export function TopBar(): React.JSX.Element {
  const { kind, setKind, search, setSearch, toggleSettings } = useUi();
  const [draft, setDraft] = useState(search);

  useEffect(() => {
    const id = setTimeout(() => setSearch(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [draft, setSearch]);

  return (
    <header className={`${styles.bar} titlebar-drag`}>
      <button
        type="button"
        className={styles.kind}
        // Series has no library root yet, so this toggles but stays on movies.
        onClick={() => setKind(kind === 'movie' ? 'series' : 'movie')}
      >
        <span className={styles.kindLabel}>{kind === 'movie' ? 'Movies' : 'Series'}</span>
        <Icon name="chevron-down" size={14} />
      </button>

      <div className={styles.search}>
        <Icon name="search" size={14} />
        <input
          className={styles.searchInput}
          value={draft}
          placeholder="Movies, series, actors, genres…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDraft('');
          }}
        />
        {draft && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            onClick={() => setDraft('')}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      <button
        type="button"
        className={styles.kind}
        style={{ minWidth: 0, padding: '0 10px' }}
        aria-label="Settings"
        onClick={toggleSettings}
      >
        <Icon name="settings" size={15} />
      </button>

      <ProfileMenu />
    </header>
  );
}
