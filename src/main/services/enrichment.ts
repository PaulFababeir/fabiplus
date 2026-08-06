import type {
  CachedImage,
  EnrichmentProgress,
  EnrichmentSummary,
  LibraryItem,
  Metadata,
  ReviewItem
} from '@shared/types';
import { POSTERS_PER_MOVIE } from '@shared/constants';
import { cacheImage } from './image-cache.js';
import { decideMatch } from './metadata/matcher.js';
import { ProviderError, type MetadataProvider, type ProviderDetails } from './metadata/provider.js';

/**
 * Walks the catalog and fills in metadata, artwork and a match confidence for
 * every film. Designed to be re-runnable: already-enriched items are skipped
 * unless `force` is set, and cached images are never refetched.
 */

/** TMDB tolerates far more, but there is no reason to hammer it. */
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;

export interface EnrichOptions {
  /** Re-fetch items that already have metadata. */
  force?: boolean;
  onProgress?: (progress: EnrichmentProgress) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries only what is worth retrying — a bad key fails immediately. */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ProviderError && err.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) throw err;
      await delay(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function cacheArtwork(
  details: ProviderDetails,
  provider: MetadataProvider
): Promise<{ posters: CachedImage[]; backdrop: CachedImage | null }> {
  const posterCandidates = details.posters.slice(0, POSTERS_PER_MOVIE);
  const settled = await Promise.all(
    posterCandidates.map((img) => cacheImage(img, 'poster', provider.imageUrl(img.path, 'poster')))
  );
  const posters = settled.filter((p): p is CachedImage => p !== null);

  let backdrop: CachedImage | null = null;
  for (const candidate of details.backdrops.slice(0, 3)) {
    backdrop = await cacheImage(candidate, 'backdrop', provider.imageUrl(candidate.path, 'backdrop'));
    if (backdrop) break;
  }

  return { posters, backdrop };
}

function toMetadata(
  details: ProviderDetails,
  providerId: string,
  posters: CachedImage[],
  backdrop: CachedImage | null
): Metadata {
  return {
    providerId,
    remoteId: details.remoteId,
    title: details.title,
    originalTitle: details.originalTitle,
    year: details.year,
    releaseDate: details.releaseDate,
    runtimeMin: details.runtimeMin,
    tagline: details.tagline,
    overview: details.overview,
    genres: details.genres,
    rating: details.rating,
    cast: details.cast,
    crew: details.crew,
    posters,
    backdrop,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Applies a match the user picked by hand, bypassing the scorer entirely.
 * Marked `correctedByUser` so a later re-enrichment never overrides it.
 */
export async function applyManualMatch(
  item: LibraryItem,
  provider: MetadataProvider,
  remoteId: number
): Promise<LibraryItem> {
  const details = await withRetry(() => provider.fetchDetails(remoteId, item.kind));
  const { posters, backdrop } = await cacheArtwork(details, provider);

  return {
    ...item,
    metadata: toMetadata(details, provider.id, posters, backdrop),
    match: { strategy: 'manual', confidence: 1, correctedByUser: true }
  };
}

/** Runs `worker` over `items` with a bounded number in flight. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function enrichLibrary(
  items: LibraryItem[],
  provider: MetadataProvider,
  options: EnrichOptions = {}
): Promise<{ items: LibraryItem[]; summary: EnrichmentSummary }> {
  const started = Date.now();
  const { force = false, onProgress } = options;

  const byId = new Map(items.map((item) => [item.id, item]));
  const targets = items.filter((item) => force || item.metadata === null);

  const review: ReviewItem[] = [];
  let done = 0;
  let matched = 0;
  let needsReview = 0;
  let failed = 0;
  let fatalError: string | null = null;

  const report = (current: string): void => {
    onProgress?.({ done, total: targets.length, current, matched, needsReview, failed });
  };

  await pool(targets, CONCURRENCY, async (item) => {
    if (fatalError) return;

    try {
      // A match the user fixed by hand is authoritative. On a forced refresh
      // we re-pull its metadata by id rather than re-running the search,
      // so the correction survives but the data still updates.
      if (item.match?.correctedByUser && item.metadata) {
        byId.set(item.id, await applyManualMatch(item, provider, item.metadata.remoteId));
        matched += 1;
        return;
      }

      const candidates = await withRetry(() =>
        provider.search(item.parsed.searchTitle, item.parsed.year, item.kind)
      );
      const decision = decideMatch(item.parsed.title, item.parsed.year, candidates);

      if (!decision.best) {
        needsReview += 1;
        review.push({
          movieId: item.id,
          folderName: item.folderName,
          parsedTitle: item.parsed.title,
          parsedYear: item.parsed.year,
          candidates: decision.alternatives.map((a) => ({
            remoteId: a.candidate.id,
            title: a.candidate.title,
            year: a.candidate.year,
            score: a.score,
            posterUrl: a.candidate.posterPath
              ? provider.imageUrl(a.candidate.posterPath, 'thumb')
              : null,
            overview: a.candidate.overview ?? ''
          }))
        });
        byId.set(item.id, {
          ...item,
          match: { strategy: 'none', confidence: 0, correctedByUser: false }
        });
        return;
      }

      const details = await withRetry(() =>
        provider.fetchDetails(decision.best!.candidate.id, item.kind)
      );
      const { posters, backdrop } = await cacheArtwork(details, provider);

      byId.set(item.id, {
        ...item,
        metadata: toMetadata(details, provider.id, posters, backdrop),
        match: {
          strategy: decision.best.strategy,
          confidence: decision.best.score,
          correctedByUser: false
        }
      });

      if (decision.accepted) {
        matched += 1;
      } else {
        // Metadata is applied provisionally so the UI is not empty, but the
        // film is still surfaced for confirmation.
        needsReview += 1;
        review.push({
          movieId: item.id,
          folderName: item.folderName,
          parsedTitle: item.parsed.title,
          parsedYear: item.parsed.year,
          candidates: [decision.best, ...decision.alternatives].map((a) => ({
            remoteId: a.candidate.id,
            title: a.candidate.title,
            year: a.candidate.year,
            score: a.score,
            posterUrl: a.candidate.posterPath
              ? provider.imageUrl(a.candidate.posterPath, 'thumb')
              : null,
            overview: a.candidate.overview ?? ''
          }))
        });
      }
    } catch (err) {
      failed += 1;
      // An invalid key fails every remaining item too — stop rather than
      // burning through 79 identical errors.
      if (err instanceof ProviderError && err.status === 401) {
        fatalError = err.message;
      }
    } finally {
      done += 1;
      report(item.parsed.title);
    }
  });

  return {
    items: [...byId.values()],
    summary: {
      total: targets.length,
      matched,
      needsReview,
      failed,
      durationMs: Date.now() - started,
      review,
      fatalError
    }
  };
}
