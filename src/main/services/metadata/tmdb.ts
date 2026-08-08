import type { CastMember, CrewMember } from '@shared/types';
import type { MediaKind } from '@shared/types';
import type { Candidate } from './matcher.js';
import {
  ProviderError,
  type MetadataProvider,
  type ProviderDetails,
  type ProviderEpisode,
  type RemoteImage
} from './provider.js';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const POSTER_SIZE = 'w500';
const THUMB_SIZE = 'w154';
/*
 * One step down from w1280. With twenty backdrops cached per film instead of
 * one, the full width would have cost roughly 240MB across an 80-film library;
 * w780 halves that and is still sharp behind a sidebar that never shows the
 * image at full width.
 */
const BACKDROP_SIZE = 'w780';
/*
 * Episode stills render in a sidebar row a little over 100px wide, so w300 is
 * already generous — and a show carries one per episode, where a film carries
 * twenty images total. Sherlock alone would be 15 stills; the next size up
 * would triple that for pixels the row never shows.
 */
const STILL_SIZE = 'w300';

/** Crew jobs worth showing in the sidebar; the full list runs to hundreds. */
const KEY_CREW_JOBS = new Set([
  'Director',
  'Writer',
  'Screenplay',
  'Story',
  'Producer',
  'Executive Producer',
  'Director of Photography',
  'Original Music Composer',
  'Editor',
  'Production Design',
  'Costume Design'
]);

const MAX_CAST = 30;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * One shape for both endpoints. TV carries `name`/`first_air_date` where film
 * carries `title`/`release_date`, so both are optional and read through
 * `pickTitle`/`pickDate` rather than duplicating the mapping.
 */
interface TmdbSearchResult {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  popularity?: number;
  poster_path?: string | null;
  overview?: string;
}

interface TmdbImage {
  file_path: string;
  width: number;
  height: number;
  vote_average?: number;
  iso_639_1?: string | null;
}

interface TmdbDetails {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  runtime?: number | null;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  /** TV carries a list of typical runtimes rather than one exact figure. */
  episode_run_time?: number[];
  created_by?: Array<{ name?: string }>;
  tagline?: string;
  overview?: string;
  vote_average?: number;
  genres?: Array<{ id: number; name: string }>;
  credits?: {
    cast?: Array<{ name?: string; character?: string; order?: number; profile_path?: string | null }>;
    crew?: Array<{ name?: string; job?: string; department?: string }>;
  };
  images?: { posters?: TmdbImage[]; backdrops?: TmdbImage[] };
}

/** TV puts the title in `name`; film puts it in `title`. */
function pickTitle(r: { title?: string; name?: string }): string {
  return r.title ?? r.name ?? '';
}

function pickOriginal(r: { original_title?: string; original_name?: string }): string {
  return r.original_title ?? r.original_name ?? '';
}

function pickDate(r: { release_date?: string; first_air_date?: string }): string | undefined {
  return r.release_date ?? r.first_air_date;
}

function yearOf(releaseDate: string | undefined): number | null {
  if (!releaseDate) return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
}

/**
 * Ranks artwork English-first.
 *
 * TMDB tags posters with no text at all as `iso_639_1: null`. Those look
 * bare in a grid — the title treatment is part of what makes a poster
 * readable at thumbnail size — so English artwork wins, textless is the
 * fallback, and other languages come last.
 */
function rankImages(images: TmdbImage[], preferText: boolean): RemoteImage[] {
  const langRank = (l: string | null): number => {
    if (l === 'en') return 0;
    if (l === null) return preferText ? 1 : 0;
    return 2;
  };

  return images
    .map((img) => ({
      path: img.file_path,
      width: img.width,
      height: img.height,
      voteAverage: img.vote_average ?? 0,
      language: img.iso_639_1 ?? null
    }))
    .sort((a, b) => {
      const byLang = langRank(a.language) - langRank(b.language);
      return byLang !== 0 ? byLang : b.voteAverage - a.voteAverage;
    });
}

export class TmdbProvider implements MetadataProvider {
  readonly id = 'tmdb';

  #key: string;
  #fetch: FetchLike;

  constructor(apiKey: string, fetchImpl?: FetchLike) {
    if (!apiKey.trim()) throw new ProviderError('TMDB API key is empty');
    this.#key = apiKey.trim();
    this.#fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** v4 read tokens are JWTs and go in a header; v3 keys go in the query. */
  get #isBearerToken(): boolean {
    return this.#key.startsWith('eyJ');
  }

  #url(path: string, params: Record<string, string> = {}): string {
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!this.#isBearerToken) url.searchParams.set('api_key', this.#key);
    return url.toString();
  }

  async #get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.#isBearerToken) headers['Authorization'] = `Bearer ${this.#key}`;

    let response: Response;
    try {
      response = await this.#fetch(this.#url(path, params), { headers });
    } catch (err) {
      // No connection, DNS failure, etc. — worth retrying later.
      throw new ProviderError(
        `Network error contacting TMDB: ${err instanceof Error ? err.message : String(err)}`,
        null,
        true
      );
    }

    if (response.status === 401) {
      throw new ProviderError('TMDB rejected the API key (401). Check it in Settings.', 401, false);
    }
    if (response.status === 429) {
      throw new ProviderError('TMDB rate limit reached (429).', 429, true);
    }
    if (!response.ok) {
      throw new ProviderError(
        `TMDB request failed: ${response.status} ${response.statusText}`,
        response.status,
        response.status >= 500
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Searches the endpoint matching the item's kind.
   *
   * A show has to go to `/search/tv`: `/search/movie` cannot return it at all,
   * and for a title like "Sherlock" it happily returns eight unrelated films
   * instead, which looks like a bad matcher rather than a wrong endpoint.
   */
  async search(title: string, year: number | null, kind: MediaKind = 'movie'): Promise<Candidate[]> {
    const path = kind === 'series' ? '/search/tv' : '/search/movie';
    // TMDB names the year filter differently per endpoint.
    const yearKey = kind === 'series' ? 'first_air_date_year' : 'year';

    const params: Record<string, string> = { query: title, include_adult: 'false' };
    if (year !== null) params[yearKey] = String(year);

    let data = await this.#get<{ results?: TmdbSearchResult[] }>(path, params);

    // A wrong year in the folder name yields zero hits; retry unconstrained
    // rather than declaring the title unmatched.
    if ((data.results?.length ?? 0) === 0 && year !== null) {
      data = await this.#get<{ results?: TmdbSearchResult[] }>(path, {
        query: title,
        include_adult: 'false'
      });
    }

    return (data.results ?? []).map((r) => ({
      id: r.id,
      title: pickTitle(r) || pickOriginal(r),
      originalTitle: pickOriginal(r) || pickTitle(r),
      year: yearOf(pickDate(r)),
      popularity: r.popularity ?? 0,
      posterPath: r.poster_path ?? null,
      overview: r.overview ?? ''
    }));
  }

  /**
   * Episode list for one season. Season 0 is TMDB's home for specials, which
   * is where the E00 files in a real release belong.
   */
  async fetchSeason(remoteId: number, seasonNumber: number): Promise<ProviderEpisode[]> {
    const data = await this.#get<{
      episodes?: Array<{
        episode_number?: number;
        name?: string;
        overview?: string;
        runtime?: number | null;
        air_date?: string | null;
        still_path?: string | null;
      }>;
    }>(`/tv/${remoteId}/season/${seasonNumber}`);

    return (data.episodes ?? []).map((e) => ({
      episodeNumber: e.episode_number ?? 0,
      name: e.name ?? '',
      overview: e.overview ?? '',
      runtimeMin: typeof e.runtime === 'number' ? e.runtime : null,
      airDate: e.air_date ?? null,
      stillPath: e.still_path ?? null
    }));
  }

  /** One request pulls details, credits and artwork together. */
  async fetchDetails(remoteId: number, kind: MediaKind = 'movie'): Promise<ProviderDetails> {
    // Deliberately NOT filtered with `include_image_language`. Restricting to
    // "en,null" starves non-English films: Solanin (ソラニン) has exactly one
    // untagged poster and the rest are tagged "ja", so the picker had nothing
    // to offer. Fetching every language and ranking client-side in
    // `rankImages` keeps English first without discarding the alternatives.
    const d = await this.#get<TmdbDetails>(
      `${kind === 'series' ? '/tv' : '/movie'}/${remoteId}`,
      { append_to_response: 'credits,images' }
    );

    const cast: CastMember[] = (d.credits?.cast ?? [])
      .slice(0, MAX_CAST)
      .map((c, i) => ({
        name: c.name ?? '',
        character: c.character ?? '',
        order: c.order ?? i,
        profilePath: c.profile_path ?? null
      }))
      .filter((c) => c.name !== '');

    const crew: CrewMember[] = (d.credits?.crew ?? [])
      .filter((c) => c.job && KEY_CREW_JOBS.has(c.job))
      .map((c) => ({
        name: c.name ?? '',
        job: c.job ?? '',
        department: c.department ?? ''
      }))
      .filter((c) => c.name !== '');

    return {
      remoteId: d.id,
      title: pickTitle(d) || pickOriginal(d),
      originalTitle: pickOriginal(d) || pickTitle(d),
      year: yearOf(pickDate(d)),
      releaseDate: pickDate(d) ?? null,
      // A show has no single runtime; its typical episode length is the useful
      // stand-in, and per-episode figures come from `fetchSeason`.
      runtimeMin: d.runtime ?? d.episode_run_time?.[0] ?? null,
      tagline: d.tagline?.trim() ? d.tagline.trim() : null,
      overview: d.overview ?? '',
      genres: (d.genres ?? []).map((g) => g.name),
      rating: typeof d.vote_average === 'number' ? d.vote_average : null,
      cast,
      crew,
      // Posters want the title art; backdrops sit behind the sidebar's own
      // text, so a clean textless plate is preferable there.
      posters: rankImages(d.images?.posters ?? [], true),
      backdrops: rankImages(d.images?.backdrops ?? [], false)
    };
  }

  imageUrl(path: string, kind: 'poster' | 'backdrop' | 'thumb' | 'still'): string {
    const size =
      kind === 'poster'
        ? POSTER_SIZE
        : kind === 'backdrop'
          ? BACKDROP_SIZE
          : kind === 'still'
            ? STILL_SIZE
            : THUMB_SIZE;
    return `${IMAGE_BASE}/${size}${path}`;
  }
}
