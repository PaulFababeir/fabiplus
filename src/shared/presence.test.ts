import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPresence, discordArtwork, type PresenceFilm } from './presence.js';
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

const base = { film: null, playing: false, remainingSec: null, selected: null, libraryCount: 79 };

describe('buildPresence', () => {
  it('shows the film and a countdown while playing', () => {
    const activity = buildPresence({ ...base, film, playing: true, remainingSec: 4200 });
    assert.equal(activity.title, 'Interstellar');
    assert.equal(activity.subtitle, '2014 · Adventure');
    assert.equal(activity.remainingSec, 4200);
    assert.equal(activity.largeImage, film.image);
  });

  /**
   * `timestamps.end` is an absolute instant, so leaving it on a paused film
   * leaves Discord counting down something that is not moving.
   */
  it('drops the countdown when paused and says so', () => {
    const activity = buildPresence({ ...base, film, playing: false, remainingSec: 4200 });
    assert.equal(activity.title, 'Interstellar');
    assert.equal(activity.subtitle, 'Paused · 2014 · Adventure');
    assert.equal(activity.remainingSec, null);
    assert.equal(activity.largeImage, film.image);
  });

  it('still reads as paused for a film with no year or genre', () => {
    const bare = { ...solanin, year: null, genre: null };
    assert.equal(buildPresence({ ...base, film: bare }).subtitle, 'Paused');
  });

  it('shows the chosen film while browsing', () => {
    const activity = buildPresence({ ...base, selected: solanin });
    assert.equal(activity.title, 'Browsing the library');
    assert.equal(activity.subtitle, 'Solanin');
    assert.equal(activity.largeImage, 'poster');
  });

  it('falls back to the library size when nothing is chosen', () => {
    const activity = buildPresence(base);
    assert.equal(activity.title, 'Browsing the library');
    assert.equal(activity.subtitle, '79 films');
  });

  it('does not say "1 films"', () => {
    assert.equal(buildPresence({ ...base, libraryCount: 1 }).subtitle, '1 film');
  });

  /** A film in the player outranks whatever is still selected behind it. */
  it('prefers the playing film over the selection', () => {
    const activity = buildPresence({ ...base, film, playing: true, selected: solanin });
    assert.equal(activity.title, 'Interstellar');
  });

  /**
   * The whole point: every state produces something, because a null would let
   * Discord fall back to the bare app-name-and-elapsed-timer activity.
   */
  it('never produces an empty title', () => {
    const states: Parameters<typeof buildPresence>[0][] = [
      base,
      { ...base, selected: solanin },
      { ...base, film, playing: true, remainingSec: 60 },
      { ...base, film, playing: false },
      { ...base, libraryCount: 0 }
    ];
    for (const state of states) assert.ok(buildPresence(state).title.length > 0);
  });
});

/** Enough of a LibraryItem to exercise the artwork branch. */
function itemWith(metadata: LibraryItem['metadata']): LibraryItem {
  return { metadata } as LibraryItem;
}

describe('discordArtwork', () => {
  it('builds a TMDB URL when the film has provider artwork', () => {
    const item = itemWith({
      providerId: 'tmdb',
      posters: [{ remotePath: '/abc.jpg' }]
    } as LibraryItem['metadata']);

    assert.equal(discordArtwork(item), 'https://image.tmdb.org/t/p/w500/abc.jpg');
  });

  it('falls back to the uploaded asset key without metadata', () => {
    assert.equal(discordArtwork(itemWith(null)), 'poster');
  });

  it('falls back when the provider has no poster', () => {
    const item = itemWith({ providerId: 'tmdb', posters: [] } as unknown as LibraryItem['metadata']);
    assert.equal(discordArtwork(item), 'poster');
  });
});
