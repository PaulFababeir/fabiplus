import { create } from 'zustand';

import type { MediaKind, SortKey } from '@shared/types';

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

  setKind: (kind: MediaKind) => void;
  setSearch: (search: string) => void;
  setGenre: (genre: string | null) => void;
  setSort: (sort: SortKey) => void;
  select: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSettings: () => void;
  setRematchOpen: (open: boolean) => void;
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

  setKind: (kind) => set({ kind, genre: null }),
  setSearch: (search) => set({ search }),
  setGenre: (genre) => set({ genre }),
  setSort: (sort) => set({ sort }),

  // Selecting a film always reveals the sidebar; that is the only way in.
  select: (selectedId) => set({ selectedId, sidebarOpen: selectedId !== null }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  setRematchOpen: (rematchOpen) => set({ rematchOpen })
}));
