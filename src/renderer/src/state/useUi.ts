import { create } from 'zustand';

import type { MediaKind, SortKey } from '@shared/types';

/**
 * Playback, mirrored out of the player so the Discord presence can be derived
 * from complete app state in one place. The player pushes this on play/pause
 * and roughly once a minute — not on every `timeupdate` tick, which would
 * re-render the shell several times a second.
 */
export interface PlaybackStatus {
  playing: boolean;
  positionSec: number;
  durationSec: number;
}

const IDLE_PLAYBACK: PlaybackStatus = { playing: false, positionSec: 0, durationSec: 0 };

interface UiStore {
  kind: MediaKind;
  search: string;
  genre: string | null;
  sort: SortKey;

  /** Film shown in the sidebar; null means nothing selected. */
  selectedId: string | null;
  /** The sidebar collapses on an empty-area click and reopens via the poster. */
  sidebarOpen: boolean;
  settingsOpen: boolean;
  rematchOpen: boolean;
  /**
   * When set, the re-match dialog shows only this film. Opening it from the
   * sidebar scopes it to what you are looking at; opening it from the review
   * banner leaves it null and lists everything outstanding.
   */
  rematchTargetId: string | null;
  /** Film currently in the player; null means the library view. */
  playingId: string | null;
  /** Mirrors config.translucentBackground, driving the CSS veil. */
  translucent: boolean;
  playback: PlaybackStatus;
  /**
   * Bumped when the Discord settings change. The presence is only pushed when
   * its content differs, so without this, switching it on mid-session would
   * publish nothing until the user happened to select or play something.
   */
  presenceEpoch: number;

  setKind: (kind: MediaKind) => void;
  setSearch: (search: string) => void;
  setGenre: (genre: string | null) => void;
  setSort: (sort: SortKey) => void;
  select: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSettings: () => void;
  setRematchOpen: (open: boolean, targetId?: string | null) => void;
  setTranslucent: (enabled: boolean) => void;
  setPlayback: (status: PlaybackStatus) => void;
  bumpPresence: () => void;
  play: (id: string) => void;
  stopPlaying: () => void;
}

export const useUi = create<UiStore>((set) => ({
  kind: 'movie',
  search: '',
  genre: null,
  sort: 'alphabetical',

  selectedId: null,
  sidebarOpen: false,
  settingsOpen: false,
  rematchOpen: false,
  rematchTargetId: null,
  playingId: null,
  translucent: true,
  playback: IDLE_PLAYBACK,
  presenceEpoch: 0,

  setKind: (kind) => set({ kind, genre: null }),
  setSearch: (search) => set({ search }),
  setGenre: (genre) => set({ genre }),
  setSort: (sort) => set({ sort }),

  // Selecting a film always reveals the sidebar; that is the only way in.
  select: (selectedId) => set({ selectedId, sidebarOpen: selectedId !== null }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  setRematchOpen: (rematchOpen, targetId = null) =>
    set({ rematchOpen, rematchTargetId: rematchOpen ? targetId : null }),

  setTranslucent: (translucent) => set({ translucent }),
  setPlayback: (playback) => set({ playback }),
  bumpPresence: () => set((s) => ({ presenceEpoch: s.presenceEpoch + 1 })),

  // Playing also selects, so returning to the library lands on that film.
  play: (id) => set({ playingId: id, selectedId: id, sidebarOpen: false, playback: IDLE_PLAYBACK }),
  stopPlaying: () => set({ playingId: null, playback: IDLE_PLAYBACK })
}));
