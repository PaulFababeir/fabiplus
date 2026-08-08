import { create } from 'zustand';

import type { Profile, ProfileState } from '@shared/types';

interface ProfileStore {
  profiles: Profile[];
  activeId: string | null;
  state: ProfileState | null;
  error: string | null;

  load: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  create: (name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  pickAvatar: (id: string) => Promise<void>;
  clearAvatar: (id: string) => Promise<void>;
  dismissError: () => void;

  setProgress: (movieId: string, positionSec: number, durationSec: number) => Promise<void>;
  clearProgress: (movieId: string) => Promise<void>;
  setFinished: (movieId: string, finished: boolean) => Promise<void>;
  choosePoster: (movieId: string, index: number) => Promise<void>;
  chooseBackdrop: (movieId: string, index: number) => Promise<void>;
}

/**
 * Electron wraps whatever a handler throws as "Error invoking remote method
 * 'profiles:delete': LastProfileError: …". Only the tail was written for a
 * person to read, and these messages are shown in the profile menu.
 */
const message = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*':\s*\w*Error:\s*/, '');
};

export const useProfile = create<ProfileStore>((set, get) => ({
  profiles: [],
  activeId: null,
  state: null,
  error: null,

  load: async () => {
    try {
      const [profiles, config] = await Promise.all([
        window.api.listProfiles(),
        window.api.getConfig()
      ]);

      // Prefer the last-used profile, but fall back if it was deleted.
      const preferred =
        profiles.find((p) => p.id === config.lastProfileId) ?? profiles[0] ?? null;

      set({
        profiles,
        activeId: preferred?.id ?? null,
        state: preferred ? await window.api.getProfileState(preferred.id) : null
      });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  switchTo: async (id) => {
    try {
      set({ activeId: id, state: await window.api.getProfileState(id) });
      await window.api.setLastProfile(id);
    } catch (err) {
      set({ error: message(err) });
    }
  },

  create: async (name) => {
    try {
      const profiles = await window.api.createProfile(name);
      const created = profiles[profiles.length - 1];
      set({ profiles });
      if (created) await get().switchTo(created.id);
    } catch (err) {
      set({ error: message(err) });
    }
  },

  remove: async (id) => {
    try {
      const profiles = await window.api.deleteProfile(id);
      set({ profiles });
      // Deleting the active profile has to land somewhere.
      if (get().activeId === id) {
        const next = profiles[0];
        if (next) await get().switchTo(next.id);
        else set({ activeId: null, state: null });
      }
    } catch (err) {
      set({ error: message(err) });
    }
  },

  rename: async (id, name) => {
    try {
      set({ profiles: await window.api.renameProfile(id, name) });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  pickAvatar: async (id) => {
    try {
      set({ profiles: await window.api.pickProfileAvatar(id), error: null });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  clearAvatar: async (id) => {
    try {
      set({ profiles: await window.api.clearProfileAvatar(id), error: null });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  dismissError: () => set({ error: null }),

  setProgress: async (movieId, positionSec, durationSec) => {
    const activeId = get().activeId;
    if (!activeId) return;
    try {
      set({ state: await window.api.setWatchProgress(activeId, movieId, positionSec, durationSec) });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  clearProgress: async (movieId) => {
    const activeId = get().activeId;
    if (!activeId) return;
    try {
      set({ state: await window.api.clearWatchProgress(activeId, movieId) });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  setFinished: async (movieId, finished) => {
    const activeId = get().activeId;
    if (!activeId) return;
    try {
      set({ state: await window.api.setWatchFinished(activeId, movieId, finished) });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  choosePoster: async (movieId, index) => {
    const activeId = get().activeId;
    if (!activeId) return;
    try {
      set({ state: await window.api.setPosterChoice(activeId, movieId, index) });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  chooseBackdrop: async (movieId, index) => {
    const activeId = get().activeId;
    if (!activeId) return;
    try {
      set({ state: await window.api.setBackdropChoice(activeId, movieId, index) });
    } catch (err) {
      set({ error: message(err) });
    }
  }
}));
