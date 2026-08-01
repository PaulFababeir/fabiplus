import type { CastMember, CrewMember } from '@shared/types';
import type { Candidate } from './matcher.js';

/**
 * The seam between the app and whatever supplies movie metadata. TMDB is the
 * only implementation today; a Letterboxd scraper can be added without the
 * enrichment pipeline or the UI knowing the difference.
 */

/** An image the provider knows about but that has not been downloaded yet. */
export interface RemoteImage {
  /** Provider-side path, e.g. "/abc123.jpg". Doubles as the cache key. */
  path: string;
  width: number;
  height: number;
  /** Used for ranking; higher is better. */
  voteAverage: number;
  /** ISO-639-1, or null for text-free artwork. */
  language: string | null;
}

export interface ProviderDetails {
  remoteId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  releaseDate: string | null;
  runtimeMin: number | null;
  tagline: string | null;
  overview: string;
  genres: string[];
  rating: number | null;
  cast: CastMember[];
  crew: CrewMember[];
  /** Ranked best-first. The enrichment step caches the top few. */
  posters: RemoteImage[];
  backdrops: RemoteImage[];
}

export interface MetadataProvider {
  /** Stable identifier stored on each Metadata record, e.g. "tmdb". */
  readonly id: string;
  search(title: string, year: number | null): Promise<Candidate[]>;
  fetchDetails(remoteId: number): Promise<ProviderDetails>;
  /**
   * Absolute URL for a remote image. `thumb` is the small size used by the
   * re-match dialog, which streams straight from the provider rather than
   * caching candidates the user may never pick.
   */
  imageUrl(path: string, kind: 'poster' | 'backdrop' | 'thumb'): string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    /** True when retrying later could plausibly succeed. */
    readonly retryable = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
