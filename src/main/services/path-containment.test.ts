import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';

import { isInside } from './path-containment.js';

const ROOT = resolve('D:/Movies');

describe('isInside', () => {
  it('accepts the root itself', () => {
    assert.equal(isInside(ROOT, ROOT), true);
  });

  it('accepts a file beneath the root', () => {
    assert.equal(isInside(join(ROOT, 'Solanin', 'film.mp4'), ROOT), true);
  });

  it('accepts a deeply nested file', () => {
    assert.equal(isInside(join(ROOT, 'a', 'b', 'c', 'd.srt'), ROOT), true);
  });

  /**
   * The one a plain `startsWith` gets wrong: a sibling directory sharing the
   * root's name as a prefix is not inside it, and treating it as such would
   * expose a folder the user never chose.
   */
  it('rejects a sibling that merely shares the prefix', () => {
    assert.equal(isInside(resolve('D:/Movies-private'), ROOT), false);
    assert.equal(isInside(resolve('D:/MoviesBackup/tax.pdf'), ROOT), false);
  });

  it('rejects a parent directory', () => {
    assert.equal(isInside(resolve('D:/'), ROOT), false);
  });

  it('rejects an unrelated path', () => {
    assert.equal(isInside(resolve('C:/Windows/System32/config/SAM'), ROOT), false);
  });

  /** Windows compares paths case-insensitively; so must this. */
  it('ignores case', () => {
    assert.equal(isInside(join(ROOT, 'Film.mp4').toLowerCase(), ROOT), true);
    assert.equal(isInside(join(ROOT, 'Film.mp4').toUpperCase(), ROOT), true);
  });

  it('handles a root given with a trailing separator', () => {
    assert.equal(isInside(join(ROOT, 'film.mp4'), ROOT + sep), true);
    assert.equal(isInside(resolve('D:/Movies-private'), ROOT + sep), false);
  });

  /**
   * Traversal is normalised away by `resolve`/`realpath` before this is
   * reached, which is exactly why callers must resolve first — the escaping
   * form must not survive that step.
   */
  it('rejects traversal once the path is resolved', () => {
    assert.equal(isInside(resolve(ROOT, '..', 'Secrets', 'keys.txt'), ROOT), false);
    assert.equal(isInside(resolve(ROOT, '..'), ROOT), false);
  });

  it('still accepts traversal that stays within the root', () => {
    assert.equal(isInside(resolve(ROOT, 'a', '..', 'b.mp4'), ROOT), true);
  });
});
