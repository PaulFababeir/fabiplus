import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Episode, LibraryItem, Season } from './types.js';
import { nextEpisode } from './next-episode.js';

function episode(id: string, number: number | null): Episode {
  return {
    id,
    number,
    title: id,
    runtimeMin: 88,
    still: null,
    video: { path: `D:/Series/Sherlock/${id}.mkv`, size: 1, ext: 'mkv' },
    subtitles: [],
    folderPath: 'D:/Series/Sherlock'
  };
}

function show(seasons: Season[]): LibraryItem {
  return {
    id: 'sherlock',
    kind: 'series',
    folderPath: 'D:/Series/Sherlock',
    folderName: 'Sherlock',
    video: { path: 'D:/Series/Sherlock/a.mkv', size: 1, ext: 'mkv' },
    subtitles: [],
    seasons,
    parsed: {
      title: 'Sherlock',
      searchTitle: 'Sherlock',
      year: 2010,
      tags: {
        resolution: null,
        source: null,
        codec: null,
        bitDepth: null,
        audio: null,
        group: null,
        flags: []
      },
      raw: 'Sherlock'
    },
    addedAt: '2026-01-01T00:00:00.000Z',
    fileModifiedAt: '2026-01-01T00:00:00.000Z',
    metadata: null,
    match: null
  };
}

const s1 = { number: 1, label: 'Season 1', episodes: [episode('s1e1', 1), episode('s1e2', 2)] };
const s2 = { number: 2, label: 'Season 2', episodes: [episode('s2e1', 1)] };
/** The real library has one of these, holding a watchable episode. */
const pilot = { number: null, label: 'Unaired Pilot', episodes: [episode('pilot', null)] };

describe('nextEpisode', () => {
  it('advances within a season', () => {
    assert.equal(nextEpisode(show([s1, s2]), 's1e1')?.id, 's1e2');
  });

  it('rolls into the next season at the end of one', () => {
    assert.equal(nextEpisode(show([s1, s2]), 's1e2')?.id, 's2e1');
  });

  it('stops at the end of the last season', () => {
    assert.equal(nextEpisode(show([s1, s2]), 's2e1'), null);
  });

  /**
   * The folder sorts before Season 1 on disk, and rolling S01E02 into a pilot
   * nobody asked for is worse than simply stopping.
   */
  it('rolls over by season number, not folder order', () => {
    assert.equal(nextEpisode(show([pilot, s1, s2]), 's1e2')?.id, 's2e1');
  });

  it('never rolls over out of an unnumbered folder', () => {
    assert.equal(nextEpisode(show([pilot, s1]), 'pilot'), null);
  });

  it('returns null for an id it does not know', () => {
    assert.equal(nextEpisode(show([s1]), 'gone'), null);
  });

  it('returns null for a film', () => {
    assert.equal(nextEpisode({ ...show([]), kind: 'movie', seasons: null }, 'anything'), null);
  });
});
