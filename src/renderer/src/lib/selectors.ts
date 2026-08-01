import type { LibraryItem, ProfileState, SortKey } from '@shared/types';

/** Derived views over the catalog. Pure, so they stay cheap to memoize. */

export function displayTitle(item: LibraryItem): string {
  return item.metadata?.title ?? item.parsed.title;
}

export function displayYear(item: LibraryItem): number | null {
  return item.metadata?.year ?? item.parsed.year;
}

/** The poster this profile picked, falling back to the provider's best. */
export function posterFor(item: LibraryItem, state: ProfileState | null): string | null {
  const posters = item.metadata?.posters ?? [];
  if (posters.length === 0) return null;
  const chosen = state?.posterChoice[item.id] ?? 0;
  return (posters[chosen] ?? posters[0])?.localPath ?? null;
}

/** Genres actually present in the library, most common first. */
export function genresOf(items: LibraryItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const genre of item.metadata?.genres ?? []) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .map(([genre]) => genre);
}

/**
 * Matches against title, cast and genre so "nolan" or "heist" finds something
 * even though neither is a title.
 */
function matchesSearch(item: LibraryItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();

  if (displayTitle(item).toLowerCase().includes(q)) return true;
  if (item.parsed.title.toLowerCase().includes(q)) return true;

  const meta = item.metadata;
  if (!meta) return false;

  if (meta.originalTitle.toLowerCase().includes(q)) return true;
  if (meta.genres.some((g) => g.toLowerCase().includes(q))) return true;
  if (meta.cast.some((c) => c.name.toLowerCase().includes(q))) return true;
  if (meta.crew.some((c) => c.name.toLowerCase().includes(q))) return true;

  return false;
}

function compare(a: LibraryItem, b: LibraryItem, sort: SortKey): number {
  switch (sort) {
    case 'alphabetical':
      return displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' });
    case 'release-date': {
      // Newest first; films with no year sink to the bottom.
      const ya = displayYear(a);
      const yb = displayYear(b);
      if (ya === null && yb === null) return 0;
      if (ya === null) return 1;
      if (yb === null) return -1;
      return yb - ya;
    }
    case 'recently-added':
      return Date.parse(b.addedAt) - Date.parse(a.addedAt);
    default:
      return 0;
  }
}

export interface FilterArgs {
  items: LibraryItem[];
  search: string;
  genre: string | null;
  sort: SortKey;
}

export function filterAndSort({ items, search, genre, sort }: FilterArgs): LibraryItem[] {
  return items
    .filter((item) => (genre === null ? true : (item.metadata?.genres ?? []).includes(genre)))
    .filter((item) => matchesSearch(item, search))
    .sort((a, b) => compare(a, b, sort));
}

/**
 * Films whose match the user should confirm, derived from the stored catalog
 * rather than the last enrichment run — otherwise restarting the app would
 * lose the list and leave a bad match permanently unfixable.
 */
export function needsReviewItems(items: LibraryItem[], threshold: number): LibraryItem[] {
  return items.filter((item) => {
    if (item.match?.correctedByUser) return false;
    if (item.metadata === null) return true;
    return (item.match?.confidence ?? 0) < threshold;
  });
}

export function runtimeLabel(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
