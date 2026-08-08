import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Episode, LibraryItem, WatchEntry } from './types.js';
import { continueWatching, isResumable, progressOf } from './continue-watching.js';

function item(id: string, title = id): LibraryItem {
  return {
    id,
    kind: 'movie',
    folderPath: `D:/Movies/${title}`,
    folderName: title,
    video: { path: `D:/Movies/${title}/f.mp4`, size: 1, ext: 'mp4' },
    subtitles: [],
    seasons: null,
    parsed: {
      title,
      searchTitle: title,
      year: 2000,
      tags: {
        resolution: null,
        source: null,
        codec: null,
        bitDepth: null,
        audio: null,
        group: null,
        flags: []
      },
      raw: title
    },
    addedAt: '2026-01-01T00:00:00.000Z',
    fileModifiedAt: '2026-01-01T00:00:00.000Z',
    metadata: null,
    match: null
  };
}

function watch(
  movieId: string,
  fraction: number,
  updatedAt: string,
  finished = false
): WatchEntry {
  return {
    movieId,
    positionSec: 6000 * fraction,
    durationSec: 6000,
    updatedAt,
    finished
  };
}

describe('progressOf', () => {
  it('clamps and handles a zero duration', () => {
    assert.equal(progressOf(watch('a', 0.5, 'x')), 0.5);
    assert.equal(progressOf({ ...watch('a', 0.5, 'x'), durationSec: 0 }), 0);
    assert.equal(progressOf({ ...watch('a', 0, 'x'), positionSec: 99999 }), 1);
  });
});

describe('isResumable', () => {
  it('skips films barely started', () => {
    assert.equal(isResumable(watch('a', 0.01, 'x')), false);
  });

  it('skips films effectively finished', () => {
    assert.equal(isResumable(watch('a', 0.95, 'x')), false);
  });

  it('skips films explicitly marked finished', () => {
    assert.equal(isResumable(watch('a', 0.5, 'x', true)), false);
  });

  it('keeps films in the middle', () => {
    assert.equal(isResumable(watch('a', 0.5, 'x')), true);
  });
});

describe('continueWatching', () => {
  const items = [item('a'), item('b'), item('c')];

  it('orders by most recently watched', () => {
    const result = continueWatching(
      {
        a: watch('a', 0.4, '2026-01-01T00:00:00.000Z'),
        b: watch('b', 0.4, '2026-03-01T00:00:00.000Z'),
        c: watch('c', 0.4, '2026-02-01T00:00:00.000Z')
      },
      items
    );
    assert.deepEqual(
      result.map((r) => r.item.id),
      ['b', 'c', 'a']
    );
  });

  it('drops entries whose film has left the library', () => {
    const result = continueWatching(
      { gone: watch('gone', 0.4, '2026-01-01T00:00:00.000Z') },
      items
    );
    assert.deepEqual(result, []);
  });

  it('caps at the requested limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`m${i}`));
    const state = Object.fromEntries(
      many.map((m, i) => [m.id, watch(m.id, 0.5, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`)])
    );
    assert.equal(continueWatching(state, many).length, 10);
    assert.equal(continueWatching(state, many, 3).length, 3);
  });

  it('excludes finished and barely-started films', () => {
    const result = continueWatching(
      {
        a: watch('a', 0.5, '2026-01-01T00:00:00.000Z'),
        b: watch('b', 0.99, '2026-01-02T00:00:00.000Z'),
        c: watch('c', 0.001, '2026-01-03T00:00:00.000Z')
      },
      items
    );
    assert.deepEqual(
      result.map((r) => r.item.id),
      ['a']
    );
  });

  it('reports progress alongside each entry', () => {
    const result = continueWatching({ a: watch('a', 0.25, '2026-01-01T00:00:00.000Z') }, items);
    assert.equal(result[0]?.progress, 0.25);
  });

  it('leaves episode null for a film', () => {
    const result = continueWatching({ a: watch('a', 0.4, '2026-01-01T00:00:00.000Z') }, items);
    assert.equal(result[0]?.episode, null);
  });
});

/**
 * Progress for a show is stored against the episode, never the show — so an id
 * that appears nowhere in `items` is the normal case, not a stale entry. Before
 * this, every part-watched episode was silently dropped from the deck.
 */
describe('continueWatching with shows', () => {
  function episode(id: string, number: number, title: string): Episode {
    return {
      id,
      number,
      title,
      runtimeMin: 88,
      still: null,
      video: { path: `D:/Series/Sherlock/S01/${id}.mkv`, size: 1, ext: 'mkv' },
      subtitles: [],
      folderPath: 'D:/Series/Sherlock/S01'
    };
  }

  const show: LibraryItem = {
    ...item('sherlock', 'Sherlock'),
    kind: 'series',
    seasons: [
      {
        number: 1,
        label: 'Season 1',
        episodes: [episode('ep1', 1, 'A Study in Pink'), episode('ep2', 2, 'The Blind Banker')]
      }
    ]
  };

  it('resolves an episode to its show and carries the episode', () => {
    const result = continueWatching({ ep2: watch('ep2', 0.5, '2026-01-01T00:00:00.000Z') }, [show]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.item.id, 'sherlock');
    assert.equal(result[0]?.episode?.id, 'ep2');
    assert.equal(result[0]?.episode?.title, 'The Blind Banker');
  });

  it('keeps two episodes of one show as two separate entries', () => {
    const result = continueWatching(
      {
        ep1: watch('ep1', 0.3, '2026-01-01T00:00:00.000Z'),
        ep2: watch('ep2', 0.6, '2026-02-01T00:00:00.000Z')
      },
      [show]
    );
    assert.deepEqual(
      result.map((r) => r.episode?.id),
      ['ep2', 'ep1']
    );
  });

  /**
   * The grid's play button passes the show's own id for anything it is given,
   * so entries predating the episode list are keyed that way and must survive.
   */
  it('still resolves a show played by its own id', () => {
    const result = continueWatching(
      { sherlock: watch('sherlock', 0.4, '2026-01-01T00:00:00.000Z') },
      [show]
    );
    assert.equal(result[0]?.item.id, 'sherlock');
    assert.equal(result[0]?.episode, null);
  });
});
