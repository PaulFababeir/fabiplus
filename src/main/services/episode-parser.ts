/**
 * Season and episode parsing for series folders.
 *
 * Kept apart from `filename-parser.ts` because the problem is different: a film
 * folder has one name to interpret, whereas a show has a folder tree whose
 * shape varies by release group. The rules here were written against a real
 * scene release rather than invented.
 */

/** A season folder, or the show root when episodes sit loose. */
export interface ParsedSeason {
  /** Season number, or null when the folder is not a numbered season. */
  number: number | null;
  /** What to show in the picker. */
  label: string;
}

export interface ParsedEpisode {
  season: number | null;
  episode: number | null;
  /** Episode title recovered from the filename, or null when absent. */
  title: string | null;
}

/**
 * Tokens that end an episode title, mirroring the film parser's strength tiers.
 * Only unambiguous markers qualify — a resolution, a source, a codec, a depth
 * or a release group. Anything that could be a real word is left alone.
 */
const HARD_STOP =
  /^(?:\d{3,4}[pi]|4k|uhd|web[-.]?dl|webrip|bluray|blu[-.]?ray|hdtv|dvdrip|brrip|remux|hevc|x26[45]|h\.?26[45]|av1|10bit|8bit|aac\d?|ac3|dts(?:[-.]?hd)?|ddp?5|5\.1|7\.1|2\.0|amzn|nf|dsnp|hmax|atvp|repack|proper|internal|complete|extended|uncut|multi|dual|subbed|dubbed)$/i;

/**
 * Reads `S01E02`, `1x02`, or a bare `E02` from a filename.
 *
 * Returns nulls rather than guessing when nothing matches: a file that cannot
 * be placed is better shown unplaced than filed under the wrong episode.
 */
export function parseEpisodeName(filename: string): ParsedEpisode {
  const stem = filename.replace(/\.[a-z0-9]{2,4}$/i, '');

  // S01E02 / s01.e02 / S01 E02, and the 1x02 form some groups use.
  const se =
    /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?:[^0-9]|$)/i.exec(stem) ??
    /(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?:[^0-9]|$)/i.exec(stem);

  if (!se) {
    // A lone E02 inside a season folder — the season comes from the folder.
    const bare = /(?:^|[^a-z0-9])e(?:p(?:isode)?)?[\s._-]*(\d{1,3})(?:[^0-9]|$)/i.exec(stem);
    if (!bare?.[1]) return { season: null, episode: null, title: null };
    return { season: null, episode: Number(bare[1]), title: titleAfter(stem, bare.index + bare[0].length) };
  }

  return {
    season: Number(se[1]),
    episode: Number(se[2]),
    title: titleAfter(stem, se.index + se[0].length)
  };
}

/**
 * Recovers the episode title sitting between the SxxExx marker and the release
 * tags. Dots and underscores are separators in scene names, so they become
 * spaces; the run stops at the first unambiguous release token.
 */
function titleAfter(stem: string, from: number): string | null {
  const rest = stem.slice(from).replace(/^[\s._-]+/, '');
  if (!rest) return null;

  const words: string[] = [];
  for (const word of rest.split(/[\s._]+/)) {
    if (!word) continue;
    // A trailing "-GROUP" is part of the release, not the title.
    const bare = word.replace(/-[a-z0-9]+$/i, '');
    if (HARD_STOP.test(word) || HARD_STOP.test(bare)) break;
    words.push(word);
  }

  const title = words.join(' ').replace(/[\s.-]+$/, '').trim();
  return title === '' ? null : title;
}

/**
 * Reads a season number from a subfolder name.
 *
 * The marker may sit anywhere in the name, because a season folder is very
 * often just the release name: `Severance.S02.1080p.WEB.h264-ETHEL` is a
 * season folder as much as `S02` is, and anchoring the match to the whole
 * name meant every bundle that did not happen to be named `S01` had to be
 * renamed by hand before the app would place it.
 *
 * Anything with no marker at all — the "Unaired Pilot" folder in the sample
 * library, "Specials", "Extras" — has no number here and is kept under its own
 * name rather than dropped, because those folders hold real episodes. The
 * scanner may still infer a number for them from the files inside; see
 * `seasonFromEpisodeNames`.
 */
export function parseSeasonFolder(name: string): ParsedSeason {
  const trimmed = name.trim();

  /*
   * `(?![0-9])` is what stops `Season 2160p` reading as season 21 and then
   * season 2 — the number has to end where it looks like it ends.
   */
  const marked = /(?:^|[^a-z0-9])s(?:eason|eries)?[\s._-]*(\d{1,2})(?![0-9])/i.exec(trimmed);
  const bare = /^(\d{1,2})$/.exec(trimmed);
  const match = marked ?? bare;

  if (match?.[1]) {
    const number = Number(match[1]);
    return { number, label: number === 0 ? 'Specials' : `Season ${number}` };
  }

  // Season 0 is the conventional home for specials, whatever the folder says.
  if (/^(?:specials?|extras?)$/i.test(trimmed)) return { number: 0, label: 'Specials' };

  return { number: null, label: trimmed };
}

/**
 * The season the files in a folder agree they belong to, or null.
 *
 * The fallback for a folder whose name says nothing — a bundle called `Disc 1`
 * whose files are all `S02E..` is season 2 whatever the folder is called.
 *
 * Unanimity is required on purpose. A folder holding a mix of seasons is a
 * flat dump rather than a season, and guessing one of them would file the rest
 * under the wrong number; leaving it unplaced is honest and still watchable.
 */
export function seasonFromEpisodeNames(filenames: string[]): number | null {
  const seasons = new Set<number>();
  for (const name of filenames) {
    const { season } = parseEpisodeName(name);
    if (season !== null) seasons.add(season);
  }
  return seasons.size === 1 ? ([...seasons][0] ?? null) : null;
}

/**
 * Strips release noise from a show folder to recover the title and year.
 *
 * `Sherlock 2010 S01-S04 Complete 720p WEB-DL HEVC x265 BONE` has to yield
 * `Sherlock` and 2010 — the season range is the marker that ends the title,
 * and it appears before the usual resolution tags.
 */
export function parseSeriesFolder(name: string): { title: string; year: number | null } {
  let rest = name.replace(/[._]+/g, ' ').trim();

  // A season range or single-season marker terminates the title.
  const range = /\bs\d{1,2}\s*-\s*s?\d{1,2}\b|\bs\d{1,2}\b|\bseasons?\s*\d/i.exec(rest);
  if (range) rest = rest.slice(0, range.index);

  let year: number | null = null;
  const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(rest);
  if (yearMatch?.[1]) {
    year = Number(yearMatch[1]);
    rest = rest.slice(0, yearMatch.index);
  }

  const title = rest
    .replace(/[([{].*$/, '')
    .replace(/[\s\-–—]+$/, '')
    .trim();

  return { title: title === '' ? name.trim() : title, year };
}
