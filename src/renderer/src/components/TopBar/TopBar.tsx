import { useEffect, useId, useRef, useState } from 'react';

import type { KindFilter } from '@shared/types';
import { TASK_COPY, useLibrary } from '@renderer/state/useLibrary';
import { useUi } from '@renderer/state/useUi';
import { useOnClickOutside, useOnEscape } from '@renderer/lib/useDismiss';
import { HoldButton } from '@renderer/components/ui/HoldButton';
import { Icon } from '@renderer/components/ui/Icon';
import { IconButton } from '@renderer/components/ui/IconButton';
import { ProfileMenu } from './ProfileMenu';
import styles from './TopBar.module.css';

/** The library views. Order here is the order in the menu. */
const KINDS: Record<KindFilter, string> = { all: 'All', movie: 'Movies', series: 'Series' };

/** Debounce so a 79-item filter doesn't run on every keystroke. */
const SEARCH_DEBOUNCE_MS = 150;

/** True when a keypress belongs to whatever the user is typing into. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * The top bar's shortcut to "Check for new films".
 *
 * A hold rather than a click: it sits one button away from Settings and the
 * search field, and a stray click starting a library scan is exactly the kind
 * of mistake a hold exists to absorb. Its result goes to the progress card,
 * not a dialog, so nothing stops the library being used while it runs.
 */
function QuickCheck(): React.JSX.Element {
  const { busy, task, quickCheck } = useLibrary();
  const tipId = useId();

  return (
    <div className={styles.quickWrap}>
      <HoldButton
        tone="accent"
        className={styles.iconButton}
        label="Quick check for new films"
        describedBy={tipId}
        // Disabled for any library work, re-match included: two writers on the
        // catalog at once is how one run silently discards the other's work.
        disabled={busy}
        onConfirm={() => void quickCheck()}
      >
        <Icon name="refresh" size={17} className={task ? styles.spinning : undefined} />
      </HoldButton>

      {/*
        A real tooltip, not `title`: the native one waits a full second, cannot
        carry a second line, and is drawn by the OS in a style nothing else in
        the app uses.
      */}
      <div id={tipId} role="tooltip" className={styles.tip}>
        <span className={styles.tipTitle}>
          {task ? `${TASK_COPY[task].running}…` : 'Quick check for new films'}
        </span>
        <span className={styles.tipBody}>
          {task
            ? 'Progress is in the card at the bottom right.'
            : 'Looks for anything added to your folders since the last check. Hold to start.'}
        </span>
      </div>
    </div>
  );
}

export function TopBar(): React.JSX.Element {
  const { kind, setKind, search, setSearch, toggleSettings, playingId } = useUi();
  const [draft, setDraft] = useState(search);
  const [kindOpen, setKindOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const kindRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useOnEscape(() => setKindOpen(false));
  useOnClickOutside(kindRef, () => setKindOpen(false));

  useEffect(() => {
    const id = setTimeout(() => setSearch(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [draft, setSearch]);

  /*
   * "/" jumps to search, the convention from GitHub and YouTube. Ignored while
   * typing anywhere — a profile name, the TMDB key — or it would steal the
   * slash out of the text. Also ignored while a dialog or the player is up:
   * both sit over the search field, and focusing it would send keystrokes into
   * a box the user cannot see.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (playingId !== null || document.querySelector('[role="dialog"]')) return;

      e.preventDefault();
      searchRef.current?.focus();
      // Selected, so typing replaces the last query rather than appending to it.
      searchRef.current?.select();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [playingId]);

  return (
    <header className={`${styles.bar} titlebar-drag`}>
      <div className={styles.kindWrap} ref={kindRef}>
        <button
          type="button"
          className={styles.kind}
          aria-haspopup="listbox"
          aria-expanded={kindOpen}
          onClick={() => setKindOpen((open) => !open)}
        >
          <span className={styles.kindLabel}>{KINDS[kind]}</span>
          <Icon name="chevron-down" size={14} />
        </button>

        {kindOpen && (
          <div className={styles.kindMenu} role="listbox">
            {(Object.keys(KINDS) as KindFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={kind === option}
                className={styles.kindOption}
                data-active={kind === option}
                onClick={() => {
                  setKind(option);
                  setKindOpen(false);
                }}
              >
                {KINDS[option]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.search}>
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          className={styles.searchInput}
          value={draft}
          placeholder="Movies, series, actors, genres…"
          aria-keyshortcuts="/"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={(e) => {
            /*
             * Leaves the field and keeps the query, so the filtered grid stays
             * put to be browsed. It used to clear the text instead; the × still
             * does that, and leaving was the half with no other way to do it.
             */
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        {draft && (
          <IconButton
            icon="close"
            label="Clear search"
            size="sm"
            className={styles.clear}
            onClick={() => setDraft('')}
          />
        )}
        {/*
          The way in while the field is idle, the way out while it is focused.
          Hidden from assistive tech, which gets `aria-keyshortcuts` instead.
        */}
        <kbd className={styles.kbd} aria-hidden="true">
          {searchFocused ? 'Esc' : '/'}
        </kbd>
      </div>

      <QuickCheck />

      <button
        type="button"
        className={styles.iconButton}
        aria-label="Settings"
        onClick={toggleSettings}
      >
        <Icon name="settings" size={17} />
      </button>

      <ProfileMenu />
    </header>
  );
}
