import { create } from 'zustand';

import type {
  EnrichmentProgress,
  EnrichmentSummary,
  LibraryCatalog,
  LibraryItem
} from '@shared/types';

/** The long-running library jobs — the ones the progress card reports on. */
export type LibraryTask = 'fetchNew' | 'rescan' | 'enrich' | 'refetch';

/**
 * The card's heading for each task in each state. Three forms rather than one
 * label with "…" trimmed off: "Checking for new films" above a list of what was
 * found reads as though it were still going.
 */
export const TASK_COPY: Record<LibraryTask, { running: string; done: string; failed: string }> = {
  fetchNew: {
    running: 'Checking for new films',
    done: 'Checked for new films',
    failed: "Couldn't check for new films"
  },
  rescan: {
    running: 'Rescanning library',
    done: 'Library rescanned',
    failed: "Couldn't rescan the library"
  },
  enrich: {
    running: 'Fetching missing metadata',
    done: 'Missing metadata fetched',
    failed: "Couldn't fetch metadata"
  },
  refetch: {
    running: 'Refetching all metadata',
    done: 'All metadata refetched',
    failed: "Couldn't refetch metadata"
  }
};

/** How a task ended, held until the card is dismissed. */
export interface TaskOutcome {
  task: LibraryTask;
  message: string;
  failed: boolean;
}

interface LibraryStore {
  catalog: LibraryCatalog | null;
  loading: boolean;
  /** True while anything is writing the catalog, re-match included. */
  busy: boolean;
  /** Load and re-match failures. Task failures go to `outcome` instead. */
  error: string | null;
  progress: EnrichmentProgress | null;
  /** What is running, for the progress card. Null when idle. */
  task: LibraryTask | null;
  outcome: TaskOutcome | null;

  load: () => Promise<void>;
  rescan: () => Promise<void>;
  enrich: (force: boolean) => Promise<void>;
  fetchNew: () => Promise<void>;
  quickCheck: () => Promise<void>;
  rematch: (movieId: string, remoteId: number) => Promise<void>;
  ensureBackdropFull: (movieId: string, index: number) => Promise<void>;
  setProgress: (progress: EnrichmentProgress | null) => void;
  dismissOutcome: () => void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "3 matched, 1 needs review" — empty counts are left out rather than listed as 0. */
function tally(summary: EnrichmentSummary): string {
  return [
    `${summary.matched} matched`,
    summary.needsReview > 0 ? `${summary.needsReview} need review` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Compares ids rather than counts: a folder that was renamed is one title gone
 * and one new, which a count would report as no change at all.
 */
function rescanMessage(before: ReadonlySet<string>, after: LibraryItem[]): string {
  const added = after.filter((item) => !before.has(item.id)).length;
  const gone = before.size - (after.length - added);

  if (added > 0 && gone > 0) return `Found ${added} new, ${gone} no longer on disk.`;
  if (added > 0) return `Found ${plural(added, 'new title', 'new titles')}.`;
  if (gone > 0) return `${plural(gone, 'title is', 'titles are')} no longer on disk.`;
  return `No changes — ${plural(after.length, 'title', 'titles')}.`;
}

export const useLibrary = create<LibraryStore>((set, get) => {
  /*
   * Every task starts and ends through these two, so the card can never be
   * left showing a task that has finished, or miss one that has started.
   */
  const begin = (task: LibraryTask): void =>
    set({ busy: true, task, error: null, outcome: null, progress: null });

  const finish = (task: LibraryTask, text: string, failed = false): void =>
    set({ busy: false, task: null, progress: null, outcome: { task, message: text, failed } });

  return {
    catalog: null,
    loading: true,
    busy: false,
    error: null,
    progress: null,
    task: null,
    outcome: null,

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
      if (get().busy) return;
      const before = new Set((get().catalog?.items ?? []).map((item) => item.id));
      begin('rescan');
      try {
        const catalog = await window.api.scanLibrary();
        set({ catalog });
        finish('rescan', rescanMessage(before, catalog.items));
      } catch (err) {
        finish('rescan', message(err), true);
      }
    },

    enrich: async (force) => {
      if (get().busy) return;
      const task: LibraryTask = force ? 'refetch' : 'enrich';
      begin(task);
      try {
        const summary = await window.api.enrichLibrary(force);
        set({ catalog: await window.api.getLibrary() });
        if (summary.fatalError) finish(task, summary.fatalError, true);
        else if (summary.total === 0) finish(task, force ? 'Nothing to refetch.' : 'Nothing was missing.');
        else
          finish(
            task,
            `${plural(summary.total, 'title', 'titles')} in ` +
              `${(summary.durationMs / 1000).toFixed(1)}s — ${tally(summary)}.`
          );
      } catch (err) {
        finish(task, message(err), true);
      }
    },

    /** Rescan plus enrichment limited to films that were not there before. */
    fetchNew: async () => {
      if (get().busy) return;
      begin('fetchNew');
      try {
        const summary = await window.api.fetchNewLibrary();
        set({ catalog: await window.api.getLibrary() });
        if (summary.fatalError) finish('fetchNew', summary.fatalError, true);
        else if (summary.total === 0) finish('fetchNew', 'No new films found.');
        else
          finish(
            'fetchNew',
            `Found ${plural(summary.total, 'new title', 'new titles')} — ${tally(summary)}.`
          );
      } catch (err) {
        finish('fetchNew', message(err), true);
      }
    },

    /**
     * The top bar's button. Without a TMDB key `fetchNew` refuses outright —
     * it cannot look anything up — but new folders can still be found, so it
     * falls back to a plain rescan and they appear under their parsed names.
     */
    quickCheck: async () => {
      if (get().busy) return;
      const config = await window.api.getConfig();
      await (config.tmdbApiKey ? get().fetchNew() : get().rescan());
    },

    /*
     * Not a task: it is one lookup, made from inside the re-match dialog, and a
     * card announcing it at the far corner of the window would be noise.
     */
    rematch: async (movieId, remoteId) => {
      set({ busy: true, error: null });
      try {
        set({ catalog: await window.api.rematch(movieId, remoteId) });
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
    dismissOutcome: () => set({ outcome: null })
  };
});
