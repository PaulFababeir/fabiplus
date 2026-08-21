import { diceCoefficient, normalizeTitle } from '../metadata/matcher.js';
import {
  parseSearchResults,
  parseSubtitleOptions,
  type SubtitleOption
} from './subtitlecat-parse.js';

/**
 * Finds and fetches subtitles from SubtitleCat.
 *
 * The second network dependency in the app, and the first that is not TMDB.
 * It is scraped rather than queried because the site has no API — see the note
 * in `subtitlecat-parse.ts` for why it is still the better choice than the one
 * that does. Everything here is best-effort: a failure returns nothing and the
 * player carries on with whatever is already beside the file.
 */

const BASE = 'https://www.subtitlecat.com';

/** Sent so the site does not serve a bot page; it refuses an empty agent. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** Search pages are large, and one is enough to rank against. */
const MAX_CANDIDATES = 12;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function get(url: string, fetchImpl?: FetchLike): Promise<string | null> {
  const doFetch = fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  try {
    const response = await doFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    // Offline, blocked, or the site is down. None of it is worth an error
    // dialog over a subtitle the user may not have wanted anyway.
    return null;
  }
}

/**
 * How well a search hit matches the file on disk.
 *
 * Deliberately scored against the *release name* rather than the film's title.
 * Subtitle timing follows the cut — an extended edition or a different source
 * drifts out of sync — so `…1080p.BluRay.x264.YIFY` beats a bare "Interstellar"
 * even though both name the same film. Falls back to the title when the file
 * has no release tags to compare.
 */
export function scoreHit(releaseName: string, videoFileName: string, title: string): number {
  const stem = videoFileName.replace(/\.[a-z0-9]{2,4}$/i, '');
  const byRelease = diceCoefficient(normalizeTitle(releaseName), normalizeTitle(stem));
  const byTitle = diceCoefficient(normalizeTitle(releaseName), normalizeTitle(title));
  return Math.max(byRelease, byTitle * 0.8);
}

/**
 * Languages available for one video, best-matching release first.
 *
 * Two requests: a search, then the page for whichever release best matches the
 * file. Returns an empty list rather than throwing — see the module note.
 */
export async function findSubtitles(
  title: string,
  year: number | null,
  videoFileName: string,
  fetchImpl?: FetchLike
): Promise<SubtitleOption[]> {
  const query = [title, year].filter(Boolean).join(' ');
  const search = await get(`${BASE}/index.php?search=${encodeURIComponent(query)}`, fetchImpl);
  if (search === null) return [];

  const ranked = parseSearchResults(search)
    .slice(0, MAX_CANDIDATES)
    .map((hit) => ({ hit, score: scoreHit(hit.title, videoFileName, title) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.hit;
  if (!best) return [];

  const page = await get(`${BASE}/${best.path}`, fetchImpl);
  return page === null ? [] : parseSubtitleOptions(page);
}

/**
 * Downloads one subtitle as text.
 *
 * Returns null on anything unexpected — including a body that does not look
 * like a subtitle at all, which is what an error page served with a 200 looks
 * like from here. Writing that to disk would leave a file the player then fails
 * to parse, with nothing to explain why.
 */
export async function fetchSubtitle(path: string, fetchImpl?: FetchLike): Promise<string | null> {
  const body = await get(`${BASE}/${path.replace(/^\//, '')}`, fetchImpl);
  if (body === null) return null;

  // A cue index and a timestamp arrow: the minimum that makes it SubRip.
  return /\d+\s*\r?\n\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(body) ? body : null;
}
