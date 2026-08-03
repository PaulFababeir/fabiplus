import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVITY_PLAYING,
  ACTIVITY_WATCHING,
  buildPresence,
  discordArtwork,
  type PresenceFilm
} from './presence.js';
import type { LibraryItem } from './types.js';

const film: PresenceFilm = {
  title: 'Interstellar',
  year: 2014,
  genre: 'Adventure',
  image: 'https://image.tmdb.org/t/p/w500/poster.jpg'
};

const solanin: PresenceFilm = {
  title: 'Solanin',
  year: 2010,
  genre: null,
  image: 'poster'
};

const base = {
  film: null,
  playing: false,
  remainingSec: null,
  selected: null,
  libraryCount: 79,
  appName: 'Fabi+'
};

describe('buildPresence', () => {
  /** Reads "Watching Interstellar" rather than the application name. */
  it('puts the film on the first line while playing', () => {
    const activity = buildPresence({ ...base, film, playing: true, remainingSec: 4200 });
    assert.equal(activity.name, 'Interstellar');
    assert.equal(activity.type, ACTIVITY_WATCHING);
    assert.equal(activity.remainingSec, 4200);
    assert.equal(activity.largeImage, film.image);
  });

  /** Year and genre belong in the grey subtext, beside the app name. */
  it('puts the app name, year and genre in the subtext', () => {
    const activity = buildPresence({ ...base, film, playing: true, remainingSec: 4200 });
    assert.equal(activity.state, 'Fabi+ · 2014 · Adventure');
    // The prominent line is left for the countdown while playing.
    assert.equal(activity.details, '');
  });

  it('omits the app name until Discord has reported it', () => {
    const activity = buildPresence({ ...base, film, playing: true, appName: null });
    assert.equal(activity.state, '2014 · Adventure');
  });

  /**
   * `timestamps.end` is an absolute instant, so leaving it on a paused film
   * leaves Discord counting down something that is not moving.
   */
  it('drops the countdown when paused and says so', () => {
    const activity = buildPresence({ ...base, film, playing: false, remainingSec: 4200 });
    assert.equal(activity.name, 'Interstellar');
    assert.equal(activity.details, 'Paused');
    assert.equal(activity.state, 'Fabi+ · 2014 · Adventure');
    assert.equal(activity.remainingSec, null);
  });

  it('still reads as paused for a film with no year or genre', () => {
    const bare = { ...solanin, year: null, genre: null };
    const activity = buildPresence({ ...base, film: bare });
    assert.equal(activity.name, 'Solanin');
    assert.equal(activity.details, 'Paused');
    assert.equal(activity.state, 'Fabi+');
  });

  /** Browsing keeps the app name — nothing else identifies the app there. */
  it('shows the chosen film while browsing', () => {
    const activity = buildPresence({ ...base, selected: solanin });
    assert.equal(activity.name, null);
    assert.equal(activity.type, ACTIVITY_PLAYING);
    assert.equal(activity.details, 'Browsing the library');
    assert.equal(activity.state, 'Solanin');
    assert.equal(activity.largeImage, 'poster');
  });

  it('falls back to the library size when nothing is chosen', () => {
    const activity = buildPresence(base);
    assert.equal(activity.name, null);
    assert.equal(activity.details, 'Browsing the library');
    assert.equal(activity.state, '79 films');
  });

  it('does not say "1 films"', () => {
    assert.equal(buildPresence({ ...base, libraryCount: 1 }).state, '1 film');
  });

  /** A film in the player outranks whatever is still selected behind it. */
  it('prefers the playing film over the selection', () => {
    const activity = buildPresence({ ...base, film, playing: true, selected: solanin });
    assert.equal(activity.name, 'Interstellar');
  });

  /**
   * The whole point: every state says something, because a null would let
   * Discord fall back to the bare app-name-and-elapsed-timer activity.
   */
  it('never produces a blank activity', () => {
    const states: Parameters<typeof buildPresence>[0][] = [
      base,
      { ...base, selected: solanin },
      { ...base, film, playing: true, remainingSec: 60 },
      { ...base, film, playing: false },
      { ...base, libraryCount: 0 }
    ];
    for (const state of states) {
      const activity = buildPresence(state);
      assert.ok((activity.name ?? activity.details).length > 0);
    }
  });
});


/** Enough of a LibraryItem to exercise the artwork branch. */
function itemWith(metadata: LibraryItem['metadata']): LibraryItem {
  return { metadata } as LibraryItem;
}

describe('discordArtwork', () => {
  const threePosters = itemWith({
    providerId: 'tmdb',
    posters: [
      { remotePath: '/first.jpg', localPath: 'C:/cache/first.jpg' },
      { remotePath: '/second.jpg', localPath: 'C:/cache/second.jpg' },
      { remotePath: '/third.jpg', localPath: 'C:/cache/third.jpg' }
    ]
  } as unknown as LibraryItem['metadata']);

  it('builds a TMDB URL when the film has provider artwork', () => {
    assert.equal(discordArtwork(threePosters), 'https://image.tmdb.org/t/p/w500/first.jpg');
  });

  /** The presence should show the same poster the library does. */
  it('honours the poster the profile picked', () => {
    assert.equal(discordArtwork(threePosters, 2), 'https://image.tmdb.org/t/p/w500/third.jpg');
  });

  /**
   * Sends the remote path, never the cached `localPath` — Discord fetches the
   * image itself and a path on this disk means nothing to it.
   */
  it('never sends a local file path', () => {
    for (const index of [0, 1, 2]) {
      assert.ok(discordArtwork(threePosters, index).startsWith('https://image.tmdb.org/'));
    }
  });

  /** A pick can outlive a refetch that came back with fewer posters. */
  it('falls back to the first poster when the pick is out of range', () => {
    assert.equal(discordArtwork(threePosters, 9), 'https://image.tmdb.org/t/p/w500/first.jpg');
  });

  it('falls back to the uploaded asset key without metadata', () => {
    assert.equal(discordArtwork(itemWith(null)), 'poster');
  });

  it('falls back when the provider has no poster', () => {
    const item = itemWith({ providerId: 'tmdb', posters: [] } as unknown as LibraryItem['metadata']);
    assert.equal(discordArtwork(item), 'poster');
  });
});
