import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseEpisodeName, parseSeasonFolder, parseSeriesFolder } from './episode-parser.js';

/**
 * Fixtures are the real `D:/Series` library, the same way the film parser tests
 * use the real `D:/Movies` folders.
 */

describe('parseEpisodeName', () => {
  it('reads season, episode and title from a scene release', () => {
    const parsed = parseEpisodeName('Sherlock.S01E01.A.Study.in.Pink.720p.WEB-DL.HEVC.x265-BONE.mkv');
    assert.equal(parsed.season, 1);
    assert.equal(parsed.episode, 1);
    assert.equal(parsed.title, 'A Study in Pink');
  });

  it('keeps a multi-word title together', () => {
    const parsed = parseEpisodeName('Sherlock.S04E02.The.Lying.Detective.720p.WEB-DL.HEVC.x265-BONE.mkv');
    assert.equal(parsed.title, 'The Lying Detective');
  });

  /** E00 is the special-episode convention; it must not read as "no episode". */
  it('accepts episode zero', () => {
    const parsed = parseEpisodeName('Sherlock.S04E00.The.Abominable.Bride.720p.WEB-DL.HEVC.x265-BONE.mkv');
    assert.equal(parsed.season, 4);
    assert.equal(parsed.episode, 0);
    assert.equal(parsed.title, 'The Abominable Bride');
  });

  it('handles a file with no title between the marker and the tags', () => {
    const parsed = parseEpisodeName('Sherlock.S01E00.720p.BluRay.x264-ITSat.mkv');
    assert.equal(parsed.season, 1);
    assert.equal(parsed.episode, 0);
    assert.equal(parsed.title, null);
  });

  it('reads the 1x02 form', () => {
    const parsed = parseEpisodeName('Show 2x05 Something Happens 1080p.mkv');
    assert.equal(parsed.season, 2);
    assert.equal(parsed.episode, 5);
    assert.equal(parsed.title, 'Something Happens');
  });

  it('reads a bare episode number, leaving the season to the folder', () => {
    const parsed = parseEpisodeName('E03 - The Great Game.mkv');
    assert.equal(parsed.season, null);
    assert.equal(parsed.episode, 3);
  });

  /** Better unplaced than filed under the wrong episode. */
  it('returns nulls rather than guessing', () => {
    const parsed = parseEpisodeName('random-video.mkv');
    assert.deepEqual(parsed, { season: null, episode: null, title: null });
  });

  it('does not mistake a resolution for an episode', () => {
    const parsed = parseEpisodeName('Sherlock.S01E01.A.Study.in.Pink.720p.mkv');
    assert.equal(parsed.episode, 1);
    assert.equal(parsed.title, 'A Study in Pink');
  });
});

describe('parseSeasonFolder', () => {
  it('reads the S01 form used by the sample library', () => {
    assert.deepEqual(parseSeasonFolder('S01'), { number: 1, label: 'Season 1' });
    assert.deepEqual(parseSeasonFolder('S04'), { number: 4, label: 'Season 4' });
  });

  it('reads spelled-out forms', () => {
    assert.equal(parseSeasonFolder('Season 2').number, 2);
    assert.equal(parseSeasonFolder('Series 3').number, 3);
    assert.equal(parseSeasonFolder('2').number, 2);
  });

  /**
   * The sample library has an "Unaired Pilot" folder holding a real episode.
   * Dropping unnumbered folders would hide watchable content.
   */
  it('keeps an unnumbered folder under its own name', () => {
    assert.deepEqual(parseSeasonFolder('Unaired Pilot'), {
      number: null,
      label: 'Unaired Pilot'
    });
  });

  it('files specials as season zero whatever the folder is called', () => {
    assert.deepEqual(parseSeasonFolder('Specials'), { number: 0, label: 'Specials' });
    assert.deepEqual(parseSeasonFolder('S00'), { number: 0, label: 'Specials' });
  });
});

describe('parseSeriesFolder', () => {
  /** The exact folder name in the sample library. */
  it('recovers title and year from a complete-series release', () => {
    assert.deepEqual(
      parseSeriesFolder('Sherlock 2010 S01-S04 Complete 720p WEB-DL HEVC x265 BONE'),
      { title: 'Sherlock', year: 2010 }
    );
  });

  it('handles a single-season release', () => {
    assert.deepEqual(parseSeriesFolder('Breaking Bad S05 1080p BluRay x265'), {
      title: 'Breaking Bad',
      year: null
    });
  });

  it('handles dots as separators', () => {
    assert.deepEqual(parseSeriesFolder('The.Wire.2002.S01-S05.1080p'), {
      title: 'The Wire',
      year: 2002
    });
  });

  it('keeps a title that has no release tags at all', () => {
    assert.deepEqual(parseSeriesFolder('Sherlock'), { title: 'Sherlock', year: null });
  });

  /** A number in the title must not be eaten as a season marker. */
  it('does not truncate a title containing a digit', () => {
    assert.equal(parseSeriesFolder('Person of Interest 2011 S01-S05 1080p').title, 'Person of Interest');
  });
});
