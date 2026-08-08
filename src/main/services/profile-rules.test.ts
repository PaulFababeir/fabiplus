import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Profile } from '@shared/types';
import { wouldEmptyProfiles } from './profile-rules.js';

function profile(id: string): Profile {
  return {
    id,
    name: id,
    accent: '#a78bfa',
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
