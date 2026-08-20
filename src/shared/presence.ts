import { APP_ICON_URL, TMDB_IMAGE_BASE } from './constants.js';
import type { DiscordActivity, LibraryItem } from './types.js';

/**
 * What the app publishes to Discord, for every state it can be in.
 *
 * The app always has *something* to say while it is open. Sending null clears
 * the Rich Presence, at which point Discord falls back to the bare detected-app
 * line — the app name and an elapsed timer, with no title or artwork. That is
 * the thing this exists to prevent, so nothing here ever returns null; the
 * presence is only cleared when the process exits and the socket closes.
 */

/** Shown when no film is open. Discord puts this on the second line. */
const BROWSING = 'Farming My Letterboxd';

/**
 * Discord's activity verbs, rendered before the first line.
 *
 * The local RPC socket honours `type` — verified against the desktop client,
 * which echoes the value back. A client that ignored it would simply say
 * "Playing", so this degrades quietly rather than failing.
 */
export const ACTIVITY_PLAYING = 0;
export const ACTIVITY_WATCHING = 3;

/**
 * Artwork for anything with no poster of its own: the idle state, which is what
 * the app shows before a film has ever been selected, and a film the provider
 * had no images for.
 *
 * This was the asset key `poster`, which nobody ever uploaded to the Discord
 * application — an unresolvable key is what put the "?" placeholder on the idle
 * card. The app icon is served over https instead, exactly like the TMDB poster
 * URLs the playing states already send.
 */
export const FALLBACK_ART = APP_ICON_URL;

/**
 * Newer Discord clients accept an https URL in `large_image`; older ones only
 * resolve asset keys uploaded to the application. Sending the poster URL costs
 * nothing when unsupported — Discord ignores what it cannot resolve — and gets
 * per-film artwork on clients that do handle it, which is confirmed to include
 * current desktop builds.
 *
 * `posterIndex` is the profile's pick, so the presence shows the same artwork
 * the library does. It is deliberately the *remote* path and not the cached
 * `localPath` the UI renders: Discord fetches the image from its own servers,
 * and a path on this disk is meaningless to it.
 */
export function discordArtwork(item: LibraryItem, posterIndex = 0): string {
  const meta = item.metadata;
  if (meta?.providerId !== 'tmdb') return FALLBACK_ART;

  // A stale pick — the choice outlives a refetch that returned fewer posters.
  const poster = meta.posters[posterIndex] ?? meta.posters[0];
  return poster ? `${TMDB_IMAGE_BASE}/w500${poster.remotePath}` : FALLBACK_ART;
}

/**
 * A film reduced to the fields the presence needs.
 *
 * Taking primitives rather than a `LibraryItem` keeps this free of the
 * renderer's display helpers, which is what lets the whole thing be pure and
 * tested without duplicating the title/year fallback those helpers own.
 */
export interface PresenceFilm {
  title: string;
  year: number | null;
  genre: string | null;
  /**
   * For an episode: what to show instead of year and genre. "Season 1 · The
   * Great Game" says more about what is on screen than "2010 · Crime" does,
   * which is identical for every episode of the show.
   */
  episodeLine: string | null;
  /** Asset key or image URL. */
  image: string;
}

export interface PresenceInput {
  /** The film open in the player, or null in the library view. */
  film: PresenceFilm | null;
  /** True only while the video is actually advancing. */
  playing: boolean;
  /** Seconds left, or null when the runtime is not known yet. */
  remainingSec: number | null;
  /** Film chosen in the library, shown when nothing is playing. */
  selected: PresenceFilm | null;
  /** Size of the library, for the idle line. */
  libraryCount: number;
  /**
   * The Discord application's name, which only Discord can tell us. Null until
   * it has, in which case the subtext simply omits it.
   */
  appName: string | null;
}

/** The grey line under the title: "Fabi+ · 2013 · Horror". */
function describe(film: PresenceFilm, appName: string | null): string {
  const detail = film.episodeLine !== null ? [film.episodeLine] : [film.year, film.genre];
  return [appName, ...detail].filter(Boolean).join(' · ');
}

export function buildPresence(input: PresenceInput): DiscordActivity {
  const { film, playing, remainingSec, selected, libraryCount, appName } = input;

  // A film takes over the first line, so it reads "Watching Interstellar"
  // rather than the app name. Browsing keeps the app name — that is the only
  // thing identifying the app when no film is open.
  //
  // Discord renders `details` prominently and `state` as grey subtext, so the
  // year and genre go in `state` alongside the app name, leaving `details` for
  // the one thing worth calling out. While playing that is nothing: the
  // countdown takes the line instead.
  if (film) {
    return {
      name: film.title,
      type: ACTIVITY_WATCHING,
      details: playing ? '' : 'Paused',
      state: describe(film, appName),
      // No countdown while paused: `timestamps.end` is an absolute wall-clock
      // instant, so Discord would count down a film that is not moving.
      remainingSec: playing ? remainingSec : null,
      largeImage: film.image
    };
  }

  /*
   * A film is open in the sidebar. It goes on the prominent line rather than
   * the grey one — "Farming My Letterboxd" is the joke for having nothing
   * chosen, and it was pushing the one piece of actual information down into
   * the subtext.
   *
   * The app name is not repeated here the way it is while playing: line one is
   * already the app name, because `name` is null.
   */
  if (selected) {
    return {
      name: null,
      type: ACTIVITY_PLAYING,
      details: `Browsing: ${selected.title}`,
      state: [selected.year, selected.genre].filter(Boolean).join(' · '),
      remainingSec: null,
      largeImage: selected.image
    };
  }

  return {
    name: null,
    type: ACTIVITY_PLAYING,
    details: BROWSING,
    state: libraryCount === 1 ? '1 film' : `${libraryCount} films`,
    remainingSec: null,
    largeImage: FALLBACK_ART
  };
}
