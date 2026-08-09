import { create } from 'zustand';

import type { EnrichmentProgress, EnrichmentSummary, LibraryCatalog } from '@shared/types';

interface LibraryStore {
  catalog: LibraryCatalog | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  progress: EnrichmentProgress | null;
  summary: EnrichmentSummary | null;

  load: () => Promise<void>;
  rescan: () => Promise<void>;
  enrich: (force: boolean) => Promise<void>;
  fetchNew: () => Promise<void>;
  rematch: (movieId: string, remoteId: number) => Promise<void>;
  ensureBackdropFull: (movieId: string, index: number) => Promise<void>;
  setProgress: (progress: EnrichmentProgress | null) => void;
  dismissSummary: () => void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const useLibrary = create<LibraryStore>((set, get) => ({
  catalog: null,
  loading: true,
  busy: false,
  error: null,
  progress: null,
  summary: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const stored = await window.api.getLibrary();
      // A first run has no catalog yet, so fall straight through to a scan.
      const catalog = stored.items.length > 0 ? stored : await window.api.scanLibrary();
      set({ catalog, loading: false });
    } catch (err) {
      set({ error: message(err), loading: false });
    }
  },

  rescan: async () => {
    set({ busy: true, error: null });
    try {
      set({ catalog: await window.api.scanLibrary() });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  enrich: async (force) => {
    set({ busy: true, error: null, summary: null });
    try {
      const summary = await window.api.enrichLibrary(force);
      set({
        summary,
        catalog: await window.api.getLibrary(),
        error: summary.fatalError
      });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false, progress: null });
    }
  },

  /** Rescan plus enrichment limited to films that were not there before. */
  fetchNew: async () => {
    set({ busy: true, error: null, summary: null });
    try {
      const summary = await window.api.fetchNewLibrary();
      set({ summary, catalog: await window.api.getLibrary(), error: summary.fatalError });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false, progress: null });
    }
  },

  rematch: async (movieId, remoteId) => {
    set({ busy: true, error: null });
    try {
      set({ catalog: await window.api.rematch(movieId, remoteId) });
      // Drop the corrected film from the outstanding review list.
      const summary = get().summary;
      if (summary) {
        set({
          summary: {
            ...summary,
            review: summary.review.filter((r) => r.movieId !== movieId),
            needsReview: Math.max(0, summary.needsReview - 1)
          }
        });
      }
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Pulls the full-size copy of a backdrop that was cached only as a preview.
   *
   * Deliberately not `busy`: this runs after the picker has already closed and
   * the chosen backdrop is on screen, so flagging the library as busy would put
   * a spinner over a UI that is working perfectly. A failure is silent for the
   * same reason — the preview is already showing and the upgrade retries the
   * next time the backdrop is picked.
   */
  ensureBackdropFull: async (movieId, index) => {
    try {
      set({ catalog: await window.api.ensureBackdropFull(movieId, index) });
    } catch {
      // Offline, or no API key. The preview stands.
    }
  },

  setProgress: (progress) => set({ progress }),
  dismissSummary: () => set({ summary: null })
}));
