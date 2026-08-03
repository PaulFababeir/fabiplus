/**
 * Values shared by main and renderer.
 *
 * These live here rather than beside their implementations because both
 * processes need them and neither may import the other. Several started out
 * duplicated — a matcher threshold copied into the UI, an attribution string
 * written twice — which is exactly the drift this file exists to prevent.
 */

/** Most profiles a single install may hold. */
export const MAX_PROFILES = 5;

/**
 * How many posters to cache per film. The picker shows all of them, so this is
 * the ceiling on choice. Twenty w500 posters is roughly 1.4MB per film —
 * negligible beside the video sitting next to it.
 */
export const POSTERS_PER_MOVIE = 20;

/** At or above this score a provider match is accepted without asking. */
export const AUTO_ACCEPT = 0.75;

/** Below this it is treated as no match at all rather than a guess. */
export const REJECT_BELOW = 0.45;

/** Public CDN base for TMDB artwork. */
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * Required by the TMDB free-tier terms, rendered in the sidebar footer.
 */
export const TMDB_ATTRIBUTION =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';
