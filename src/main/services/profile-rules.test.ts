import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Profile } from '@shared/types';
import { isSafeProfileId, wouldEmptyProfiles } from './profile-rules.js';

function profile(id: string): Profile {
  return {
    id,
    name: id,
    accent: '#88a34d',
    avatarPath: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('wouldEmptyProfiles', () => {
  /**
   * The one that matters. `profiles.json` has no recovery path, and an empty
   * one silently orphans every `profiles/<id>.json` beside it.
   */
  it('refuses the only profile', () => {
    assert.equal(wouldEmptyProfiles([profile('a')], 'a'), true);
  });

  it('allows a delete that leaves someone behind', () => {
    assert.equal(wouldEmptyProfiles([profile('a'), profile('b')], 'a'), false);
    assert.equal(wouldEmptyProfiles([profile('a'), profile('b')], 'b'), false);
  });

  /** Deleting something already gone is a no-op, not a refusal. */
  it('does not refuse an id that is not in the list', () => {
    assert.equal(wouldEmptyProfiles([profile('a')], 'gone'), false);
    assert.equal(wouldEmptyProfiles([], 'a'), false);
  });
});

/*
 * The traversal guard. `profileStatePath` interpolates this straight into a
 * filename, and the id arrives from the renderer on every profile call.
 */
describe('isSafeProfileId', () => {
  it('accepts the uuid every profile is minted with', () => {
    assert.ok(isSafeProfileId('4d61ef1d-d50e-45cf-b66f-f31f8e313c53'));
  });

  it('refuses a traversal', () => {
    assert.equal(isSafeProfileId('../../../evil'), false);
    assert.equal(isSafeProfileId('..'), false);
  });

  it('refuses separators in either direction', () => {
    assert.equal(isSafeProfileId('a/b'), false);
    assert.equal(isSafeProfileId('a' + String.fromCharCode(92) + 'b'), false);
  });

  it('refuses an absolute path or a drive letter', () => {
    assert.equal(isSafeProfileId('/etc/passwd'), false);
    assert.equal(isSafeProfileId('C:evil'), false);
  });

  it('refuses a name that is not one', () => {
    assert.equal(isSafeProfileId(''), false);
    assert.equal(isSafeProfileId('a.json'), false);
    assert.equal(isSafeProfileId('trailing '), false);
    assert.equal(isSafeProfileId('a' + String.fromCharCode(0) + 'b'), false);
  });

  it('refuses an id long enough to blow the path limit', () => {
    assert.equal(isSafeProfileId('a'.repeat(129)), false);
  });
});
