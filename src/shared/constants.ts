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

/**
 * How many backdrops to cache per film, matching the posters so the pickers
 * behave alike. At w780 this is roughly 1.6MB per film — the cost is disk, not
 * metadata: twenty extra image records add about 3KB to a catalog entry.
 */
export const BACKDROPS_PER_MOVIE = 20;

/** At or above this score a provider match is accepted without asking. */
export const AUTO_ACCEPT = 0.75;

/** Below this it is treated as no match at all rather than a guess. */
export const REJECT_BELOW = 0.45;

/** Public CDN base for TMDB artwork. */
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * The Discord application this app publishes its Rich Presence under.
 *
 * Hardcoded on purpose, and safe to commit: an application ID is a public
 * identifier, not a credential. It is already broadcast in every presence
 * payload to anyone who can see the profile, and it grants nothing on its own —
 * the client secret and bot token are the secrets, and neither is used here.
 * Rich Presence over the local socket needs no authentication at all.
 *
 * It is a constant rather than a setting because the ID only decides whose
 * application *name* appears on the first line while browsing. Asking every
 * user to register their own application to see that line was real setup
 * friction for no benefit.
 */
export const DISCORD_APP_ID = '1533694975093768232';

/**
 * Public URL for the app icon, used as the Rich Presence artwork whenever there
 * is no film artwork to show.
 *
 * A URL rather than an asset key uploaded under Rich Presence → Art Assets.
 * The presence used to send the bare key `poster`, which was never uploaded to
 * the application — so Discord could not resolve it and drew its own
 * broken-image placeholder on the idle card. Discord fetches artwork from its
 * own servers, so a path on this disk is useless here and the image has to be
 * reachable from the public internet; the repo is public, and this is the same
 * mechanism that already carries every TMDB poster.
 *
 * Pinned to `main`, so `assets/icon.png` must be pushed before Discord can
 * resolve it. Until then it 404s to the same placeholder as before — no worse
 * than the state this replaced.
 */
export const APP_ICON_URL =
  'https://raw.githubusercontent.com/PaulFababeir/movie-app/main/assets/icon.png';

/**
 * Required by the TMDB free-tier terms, rendered in the sidebar footer.
 */
export const TMDB_ATTRIBUTION =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';
