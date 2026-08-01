import type { CastMember, CrewMember } from '@shared/types';
import type { Candidate } from './matcher.js';
import {
  ProviderError,
  type MetadataProvider,
  type ProviderDetails,
  type RemoteImage
} from './provider.js';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';

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

interface TmdbSearchResult {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  popularity?: number;
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

  async search(title: string, year: number | null): Promise<Candidate[]> {
    const params: Record<string, string> = { query: title, include_adult: 'false' };
    if (year !== null) params['year'] = String(year);

    let data = await this.#get<{ results?: TmdbSearchResult[] }>('/search/movie', params);

    // A wrong year in the folder name yields zero hits; retry unconstrained
    // rather than declaring the film unmatched.
    if ((data.results?.length ?? 0) === 0 && year !== null) {
      data = await this.#get<{ results?: TmdbSearchResult[] }>('/search/movie', {
        query: title,
        include_adult: 'false'
      });
    }

    return (data.results ?? []).map((r) => ({
      id: r.id,
      title: r.title ?? r.original_title ?? '',
      originalTitle: r.original_title ?? r.title ?? '',
      year: yearOf(r.release_date),
      popularity: r.popularity ?? 0
    }));
  }

  /** One request pulls details, credits and artwork together. */
  async fetchDetails(remoteId: number): Promise<ProviderDetails> {
    const d = await this.#get<TmdbDetails>(`/movie/${remoteId}`, {
      append_to_response: 'credits,images',
      include_image_language: 'en,null'
    });

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
      title: d.title ?? d.original_title ?? '',
      originalTitle: d.original_title ?? d.title ?? '',
      year: yearOf(d.release_date),
      releaseDate: d.release_date ?? null,
      runtimeMin: d.runtime ?? null,
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

  imageUrl(path: string, kind: 'poster' | 'backdrop'): string {
    const size = kind === 'poster' ? POSTER_SIZE : BACKDROP_SIZE;
    return `${IMAGE_BASE}/${size}${path}`;
  }
}

/**
 * TMDB asks that applications using the free tier display this alongside
 * their logo. Rendered in the sidebar footer.
 */
export const TMDB_ATTRIBUTION =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';
