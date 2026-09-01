import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CachedImage, LibraryItem, ProfileState } from '@shared/types';
import { normalisePicks } from './profile-picks.js';

const img = (path: string): CachedImage => ({
  remotePath: path,
  localPath: `D:/cache/images${path}`,
  width: 500,
  height: 750
});

function film(id: string, posters: string[], backdrops: string[] = []): LibraryItem {
  return {
    id,
    metadata: { posters: posters.map(img), backdrops: backdrops.map(img) }
  } as unknown as LibraryItem;
}

function state(
  posterChoice: ProfileState['posterChoice'] = {},
  backdropChoice: ProfileState['backdropChoice'] = {}
): ProfileState {
  return { schemaVersion: 3, profileId: 'p', watch: {}, posterChoice, backdropChoice };
}

describe('normalisePicks', () => {
  const items = [film('f1', ['/a.jpg', '/b.jpg', '/c.jpg'], ['/x.jpg', '/y.jpg'])];

  it('converts a legacy index into the path it points at', () => {
    const next = normalisePicks(state({ f1: 2 }), items);
    assert.equal(next?.posterChoice['f1'], '/c.jpg');
  });

  it('converts backdrops the same way', () => {
    const next = normalisePicks(state({}, { f1: 1 }), items);
    assert.equal(next?.backdropChoice['f1'], '/y.jpg');
  });

  /** Nothing to do means no write, so an upgraded profile is left untouched. */
  it('returns null when every pick is already a path', () => {
    assert.equal(normalisePicks(state({ f1: '/b.jpg' }), items), null);
  });

  it('returns null when there are no picks at all', () => {
    assert.equal(normalisePicks(state(), items), null);
  });

  /*
   * The dangerous case. Before the first scan every pick would resolve to
   * nothing, and writing that back would erase choices that are perfectly good.
   */
  it('does nothing at all against an empty catalog', () => {
    assert.equal(normalisePicks(state({ f1: 2 }), []), null);
  });

  /*
   * A film on a drive that is not plugged in is missing from the catalog, not
   * deleted — its pick has to survive to the next launch.
   */
  it('leaves a pick for a film the catalog does not have', () => {
    const next = normalisePicks(state({ f1: 1, gone: 3 }), items);
    assert.equal(next?.posterChoice['gone'], 3);
    assert.equal(next?.posterChoice['f1'], '/b.jpg');
  });

  it('leaves a pick for a film that has no artwork cached', () => {
    const next = normalisePicks(state({ f1: 1, bare: 2 }), [...items, film('bare', [])]);
    assert.equal(next?.posterChoice['bare'], 2);
  });

  /** An index past the end resolves to the first, matching what was on screen. */
  it('pins a stale index to the image it was already showing', () => {
    const next = normalisePicks(state({ f1: 9 }), items);
    assert.equal(next?.posterChoice['f1'], '/a.jpg');
  });

  it('carries the rest of the profile across untouched', () => {
    const before = state({ f1: 0 });
    before.watch['f1'] = {
      movieId: 'f1',
      positionSec: 12,
      durationSec: 100,
      finished: false,
      updatedAt: 'x'
    };
    const next = normalisePicks(before, items);

    assert.deepEqual(next?.watch, before.watch);
    assert.equal(next?.profileId, 'p');
    assert.equal(next?.schemaVersion, 3);
  });
});
