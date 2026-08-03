import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  emptyProfileState,
  migrateProfileState,
  PROFILE_SCHEMA_VERSION,
  ProfileSchemaError
} from './profile-migration.js';

const entry = {
  movieId: 'abc',
  positionSec: 120,
  durationSec: 6000,
  updatedAt: '2026-01-01T00:00:00.000Z',
  finished: false
};

describe('migrateProfileState', () => {
  it('returns a fresh state when there is no file', () => {
    assert.deepEqual(migrateProfileState(null, 'p1'), emptyProfileState('p1'));
  });

  it('loads the current version unchanged', () => {
    const stored = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profileId: 'p1',
      watch: { abc: entry },
      posterChoice: { abc: 3 }
    };
    const state = migrateProfileState(stored, 'p1');
    assert.deepEqual(state.watch, { abc: entry });
    assert.deepEqual(state.posterChoice, { abc: 3 });
  });

  /**
   * The regression this file exists for: the old loader returned an empty
   * state on any version mismatch, silently destroying watch history.
   */
  it('never returns empty for data it recognises', () => {
    const stored = { profileId: 'p1', watch: { abc: entry }, posterChoice: {} };
    const state = migrateProfileState(stored, 'p1');
    assert.equal(Object.keys(state.watch).length, 1, 'watch history must survive');
  });

  it('treats an unversioned but recognisable file as version 1', () => {
    const state = migrateProfileState({ watch: { abc: entry } }, 'p1');
    assert.equal(state.schemaVersion, PROFILE_SCHEMA_VERSION);
    assert.deepEqual(state.watch, { abc: entry });
  });

  /** A downgraded app must fail loudly, not truncate what it cannot read. */
  it('throws on data newer than this build understands', () => {
    assert.throws(
      () => migrateProfileState({ schemaVersion: 99, watch: { abc: entry } }, 'p1'),
      ProfileSchemaError
    );
  });

  it('tolerates a missing map without discarding the other', () => {
    const state = migrateProfileState({ schemaVersion: 1, watch: { abc: entry } }, 'p1');
    assert.deepEqual(state.watch, { abc: entry });
    assert.deepEqual(state.posterChoice, {});
  });

  it('ignores a malformed map rather than failing the whole load', () => {
    const state = migrateProfileState(
      { schemaVersion: 1, watch: { abc: entry }, posterChoice: 'nonsense' },
      'p1'
    );
    assert.deepEqual(state.watch, { abc: entry });
    assert.deepEqual(state.posterChoice, {});
  });

  it('always stamps the profile id from the caller', () => {
    const state = migrateProfileState({ schemaVersion: 1, profileId: 'stale' }, 'real');
    assert.equal(state.profileId, 'real');
  });

  it('rejects non-object payloads', () => {
    for (const bad of ['string', 42, [], true]) {
      assert.deepEqual(migrateProfileState(bad, 'p1'), emptyProfileState('p1'));
    }
  });
});
