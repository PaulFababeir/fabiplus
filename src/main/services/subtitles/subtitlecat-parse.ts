/**
 * Parsing for SubtitleCat's pages.
 *
 * Kept apart from the fetching so it can be tested against captured markup
 * without a network call — the same split as `matcher.ts` against the TMDB
 * client. Scraping is inherently brittle, so the shape of the page needs to be
 * pinned down by tests rather than discovered again the next time it changes.
 *
 * SubtitleCat has no API. It is used because it needs no key and no account:
 * OpenSubtitles refuses every request without a registered key and caps
 * downloads per day, which is a poor fit for an app whose whole premise is that
 * it works with no account.
 */

export interface SearchHit {
  /** Page path, relative to the site root. */
  path: string;
  /** Release name, which is what a subtitle's timing is matched to. */
  title: string;
}

export interface SubtitleOption {
  /** ISO-ish code from the flag image, e.g. `en`, `pt-BR`. */
  code: string;
  /** The site's own display name, e.g. "English". */
  language: string;
  /** Path to the `.srt`, relative to the site root. */
  path: string;
}

/**
 * Release entries from a search page.
 *
 * The link text is the release name — `Interstellar.2014.1080p.BluRay.x264.YIFY`
 * — which matters more than the film's title here: subtitle timing follows the
 * cut, so the entry whose name is closest to the file on disk is the one worth
 * downloading.
 */
export function parseSearchResults(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  const anchor = /<a\s+href="(subs\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const path = match[1];
    if (!path || seen.has(path)) continue;
    seen.add(path);

    const title = stripTags(match[2] ?? '').trim();
    if (title !== '') hits.push({ path, title });
  }

  return hits;
}

/**
 * Downloadable languages from a subtitle page.
 *
 * Each language is a `sub-single` block. A language that exists carries an
 * anchor to a `.srt`; one the site offers to machine-translate on demand does
 * not — so the absence of that link *is* the "unavailable" flag, and those are
 * skipped rather than listed as something the user can ask for.
 */
export function parseSubtitleOptions(html: string): SubtitleOption[] {
  const options: SubtitleOption[] = [];
  const seen = new Set<string>();

  // The first chunk is everything before the first block, so it is dropped.
  for (const chunk of html.split('sub-single').slice(1)) {
    const path = /href="([^"]+\.srt)"/i.exec(chunk)?.[1];
    if (!path) continue;

    const code = /alt="([A-Za-z-]{2,7})"/.exec(chunk)?.[1];
    // The flag sits inside its own span, so a span holding only text is the
    // language name and never matches the one holding the image.
    const language = /<span>\s*([^<>]{2,40}?)\s*<\/span>/.exec(chunk)?.[1];
    if (!code || !language) continue;

    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    options.push({ code, language, path: path.replace(/^\//, '') });
  }

  return options.sort((a, b) => a.language.localeCompare(b.language));
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

