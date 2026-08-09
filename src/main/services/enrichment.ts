import type {
  CachedImage,
  EnrichmentProgress,
  EnrichmentSummary,
  LibraryItem,
  Metadata,
  ReviewItem,
  Season
} from '@shared/types';
import { BACKDROPS_PER_MOVIE, POSTERS_PER_MOVIE } from '@shared/constants';
import { cacheImage } from './image-cache.js';
import { withBackdropFull } from './library-merge.js';
import { decideMatch } from './metadata/matcher.js';
import {
  ProviderError,
  type MetadataProvider,
  type ProviderDetails,
  type ProviderEpisode
} from './metadata/provider.js';

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
): Promise<{ posters: CachedImage[]; backdrops: CachedImage[] }> {
  const posterCandidates = details.posters.slice(0, POSTERS_PER_MOVIE);
  const settled = await Promise.all(
    posterCandidates.map((img) => cacheImage(img, 'poster', provider.imageUrl(img.path, 'poster')))
  );
  const posters = settled.filter((p): p is CachedImage => p !== null);

  /*
   * Twenty, like the posters, so the picker has the same range of choice — but
   * only the first is fetched at full size. The rest are previews for the
   * picker grid and get their large version on demand, if one is ever chosen.
   *
   * Failures are skipped rather than aborting: one bad URL should not cost the
   * film every other backdrop.
   */
  const backdrops: CachedImage[] = [];
  for (const [index, candidate] of details.backdrops.slice(0, BACKDROPS_PER_MOVIE).entries()) {
    const preview = await cacheImage(
      candidate,
      'backdrop',
      provider.imageUrl(candidate.path, 'backdrop-preview')
    );
    if (!preview) continue;

    const full =
      index === 0 ? await fetchFullBackdrop(candidate.path, candidate, provider) : null;
    backdrops.push({ ...preview, fullPath: full });
  }

  return { posters, backdrops };
}

/**
 * Downloads the full-size version of one backdrop and returns its local path.
 *
 * Separate from the preview pass so it can also be called long after
 * enrichment, the first time a profile picks a backdrop that was only ever
 * cached small. Null on failure, which leaves the preview standing rather than
 * blanking the sidebar.
 */
export async function fetchFullBackdrop(
  remotePath: string,
  size: { width: number; height: number },
  provider: MetadataProvider
): Promise<string | null> {
  const cached = await cacheImage(
    { path: remotePath, width: size.width, height: size.height },
    'backdrop',
    provider.imageUrl(remotePath, 'backdrop')
  );
  return cached?.localPath ?? null;
}

/**
 * Ensures the chosen backdrop exists at full size, returning the item with
 * `fullPath` filled in — or the same item when there is nothing to do.
 *
 * The picker only ever had previews for anything but the default, so this is
 * what upgrades one the moment it is actually put on screen. Already-fetched
 * backdrops short-circuit, so picking back and forth costs nothing.
 */
export async function withFullBackdrop(
  item: LibraryItem,
  index: number,
  provider: MetadataProvider
): Promise<LibraryItem> {
  const target = item.metadata?.backdrops?.[index];
  if (!target || target.fullPath) return item;

  const fullPath = await fetchFullBackdrop(target.remotePath, target, provider);
  if (!fullPath) return item;

  return withBackdropFull(item, index, fullPath);
}

function toMetadata(
  details: ProviderDetails,
  providerId: string,
  posters: CachedImage[],
  backdrops: CachedImage[]
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
    // The legacy single field stays populated so a build that predates the
    // picker still finds an image where it expects one.
    backdrop: backdrops[0] ?? null,
    backdrops,
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
  const { posters, backdrops } = await cacheArtwork(details, provider);

  return {
    ...item,
    seasons: await enrichSeasons(item, provider, remoteId),
    metadata: toMetadata(details, provider.id, posters, backdrops),
    match: { strategy: 'manual', confidence: 1, correctedByUser: true }
  };
}


/**
 * Downloads one episode thumbnail.
 *
 * The season endpoint reports no dimensions for a still, so the zeros are what
 * the provider actually gave us rather than a placeholder — nothing reads them,
 * because the row sizes the image by aspect ratio.
 */
async function cacheStill(
  stillPath: string | null,
  provider: MetadataProvider
): Promise<CachedImage | null> {
  if (stillPath === null) return null;
  return cacheImage(
    { path: stillPath, width: 0, height: 0 },
    'still',
    provider.imageUrl(stillPath, 'still')
  );
}

/**
 * Fills in episode titles, runtimes and thumbnails from the provider.
 *
 * Runtime is the reason this exists: it appears nowhere in a filename, so the
 * episode list has no subtext without it. Titles are taken too when the parser
 * could not recover one, but a filename title wins — it describes the file the
 * user actually has, which matters for releases whose numbering drifts from
 * the provider's.
 *
 * Seasons the provider does not know (an "Unaired Pilot" folder) are left as
 * they were rather than dropped.
 */
async function enrichSeasons(
  item: LibraryItem,
  provider: MetadataProvider,
  remoteId: number
): Promise<Season[] | null> {
  if (item.kind !== 'series' || item.seasons === null) return item.seasons;

  const seasons: Season[] = [];
  for (const season of item.seasons) {
    if (season.number === null) {
      seasons.push(season);
      continue;
    }

    const remote = await provider
      .fetchSeason(remoteId, season.number)
      .catch(() => [] as ProviderEpisode[]);
    const byNumber = new Map(remote.map((e) => [e.episodeNumber, e]));

    const episodes = await Promise.all(
      season.episodes.map(async (episode) => {
        const match = episode.number === null ? undefined : byNumber.get(episode.number);
        if (!match) return episode;
        return {
          ...episode,
          title: episode.title ?? (match.name === '' ? null : match.name),
          runtimeMin: match.runtimeMin,
          // A failed download leaves whatever was already cached rather than
          // blanking the row — one bad URL is not worth losing the thumbnail.
          still: (await cacheStill(match.stillPath, provider)) ?? episode.still
        };
      })
    );

    seasons.push({ ...season, episodes });
  }

  return seasons;
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
      const { posters, backdrops } = await cacheArtwork(details, provider);

      byId.set(item.id, {
        ...item,
        seasons: await enrichSeasons(item, provider, decision.best!.candidate.id),
        metadata: toMetadata(details, provider.id, posters, backdrops),
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
