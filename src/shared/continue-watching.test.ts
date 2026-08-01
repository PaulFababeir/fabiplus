import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LibraryItem, WatchEntry } from './types.js';
import { continueWatching, isResumable, progressOf } from './continue-watching.js';

function item(id: string, title = id): LibraryItem {
  return {
    id,
    kind: 'movie',
    folderPath: `D:/Movies/${title}`,
    folderName: title,
    video: { path: `D:/Movies/${title}/f.mp4`, size: 1, ext: 'mp4' },
    subtitles: [],
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
});
