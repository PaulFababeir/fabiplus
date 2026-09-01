import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickedIndex, pickedPath } from './artwork-pick.js';

const images = [{ remotePath: '/a.jpg' }, { remotePath: '/b.jpg' }, { remotePath: '/c.jpg' }];

describe('pickedIndex', () => {
  it('finds the image a path names', () => {
    assert.equal(pickedIndex(images, '/c.jpg'), 2);
  });

  /*
   * The whole point of the change. A refetch re-ranks the list, so the poster
   * that was second can end up third — a path follows it, an index does not.
   */
  it('follows an image that moved in the list', () => {
    const reranked = [{ remotePath: '/c.jpg' }, { remotePath: '/a.jpg' }, { remotePath: '/b.jpg' }];
    assert.equal(pickedIndex(reranked, '/b.jpg'), 2);
    assert.equal(pickedIndex(images, '/b.jpg'), 1);
  });

  it('falls back to the first when the chosen image is gone', () => {
    assert.equal(pickedIndex(images, '/deleted.jpg'), 0);
  });

  it('defaults to the first when nothing was chosen', () => {
    assert.equal(pickedIndex(images, undefined), 0);
  });

  /** Legacy picks keep working until `normalisePicks` converts them. */
  it('still reads a legacy index', () => {
    assert.equal(pickedIndex(images, 1), 1);
  });

  it('absorbs a legacy index past the end of a shorter list', () => {
    assert.equal(pickedIndex(images, 9), 0);
  });

  it('rejects a negative or fractional index rather than returning it', () => {
    assert.equal(pickedIndex(images, -1), 0);
    assert.equal(pickedIndex(images, 1.5), 0);
  });

  it('returns 0 for an empty list, so callers only test the lookup', () => {
    assert.equal(pickedIndex([], '/a.jpg'), 0);
  });
});

describe('pickedPath', () => {
  it('gives back the path a legacy index points at', () => {
    assert.equal(pickedPath(images, 2), '/c.jpg');
  });

  it('is null when there is nothing to point at', () => {
    assert.equal(pickedPath([], 0), null);
  });
});
