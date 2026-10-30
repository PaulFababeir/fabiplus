import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AppConfig } from '@shared/types';
import { toRendererConfig } from './renderer-config.js';

// Distinctive and obviously fake: the test only needs a string to look for.
const KEY = 'fake-tmdb-key-for-tests';

function config(tmdbApiKey: string | null): AppConfig {
  return {
    schemaVersion: 1,
    movieRoots: ['D:/Movies'],
    seriesRoots: ['D:/Series'],
    tmdbApiKey,
    lastProfileId: 'p1',
    translucentBackground: true,
    videoBrightness: 1,
    discordPresence: false,
    discordAppId: null
  };
}

describe('toRendererConfig', () => {
  it('says a key exists without saying what it is', () => {
    const out = toRendererConfig(config(KEY));
    assert.equal(out.hasTmdbKey, true);
    assert.equal('tmdbApiKey' in out, false);
  });

  /*
   * The check that matters: what actually crosses the IPC boundary is a
   * serialised copy, so the key must not appear anywhere in it — not under
   * another name, not nested.
   */
  it('leaves no trace of the key in what is sent', () => {
    assert.equal(JSON.stringify(toRendererConfig(config(KEY))).includes(KEY), false);
  });

  it('reports no key as no key', () => {
    assert.equal(toRendererConfig(config(null)).hasTmdbKey, false);
  });

  it('carries every other setting across untouched', () => {
    const out = toRendererConfig(config(KEY));
    assert.deepEqual(out.movieRoots, ['D:/Movies']);
    assert.equal(out.lastProfileId, 'p1');
    assert.equal(out.translucentBackground, true);
  });
});
