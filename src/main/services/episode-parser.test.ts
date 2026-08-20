import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseEpisodeName,
  parseSeasonFolder,
  parseSeriesFolder,
  seasonFromEpisodeNames
} from './episode-parser.js';

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

/**
 * A season folder is very often just the release name. Anchoring the match to
 * the whole folder name is what forced every bundle that was not literally
 * called `S01` to be renamed by hand before the app would place it.
 */
describe('parseSeasonFolder with release-named folders', () => {
  it('finds the season anywhere in the name', () => {
    assert.deepEqual(parseSeasonFolder('Severance.S02.1080p.WEB.h264-ETHEL'), {
      number: 2,
      label: 'Season 2'
    });
    assert.deepEqual(parseSeasonFolder('The.100.S03.WEBRip.x265'), {
      number: 3,
      label: 'Season 3'
    });
  });

  /** The picker should read "Season 2", not the release string. */
  it('labels by number rather than by folder name', () => {
    assert.equal(parseSeasonFolder('Severance.S02.1080p.WEB.h264-ETHEL').label, 'Season 2');
    assert.equal(parseSeasonFolder('Season 2 - The Fall').label, 'Season 2');
  });

  /** `Season 2160p` is a resolution, not season 21 and not season 2. */
  it('does not cut a number short to force a match', () => {
    assert.equal(parseSeasonFolder('Season 2160p').number, null);
  });

  /** Still no number, so the scanner can keep it under its own name. */
  it('leaves a folder with no marker alone', () => {
    assert.deepEqual(parseSeasonFolder('Unaired Pilot'), {
      number: null,
      label: 'Unaired Pilot'
    });
  });
});

describe('seasonFromEpisodeNames', () => {
  it('reads the season the files agree on', () => {
    assert.equal(
      seasonFromEpisodeNames([
        'Severance.S02E01.1080p.mkv',
        'Severance.S02E02.1080p.mkv',
        'Severance.S02E03.1080p.mkv'
      ]),
      2
    );
  });

  /** A folder holding two seasons is a flat dump, not a season. */
  it('refuses to guess when the files disagree', () => {
    assert.equal(seasonFromEpisodeNames(['Show.S01E01.mkv', 'Show.S02E01.mkv']), null);
  });

  /** A bare `E03` carries no season — that is the folder's job. */
  it('returns null when nothing states a season', () => {
    assert.equal(seasonFromEpisodeNames(['E03 - The Great Game.mkv', 'random-video.mkv']), null);
  });

  it('handles the 1x02 form', () => {
    assert.equal(seasonFromEpisodeNames(['Show 2x05 Something.mkv', 'Show 2x06 Else.mkv']), 2);
  });

  it('survives an empty folder', () => {
    assert.equal(seasonFromEpisodeNames([]), null);
  });
});

/**
 * Punctuation in a show's name. Release folders use dots as separators, but a
 * dot is also just a dot — and collapsing both alike made a show display under
 * a title nobody writes, while a film in the same folder shape parsed fine.
 */
describe('parseSeriesFolder with punctuation', () => {
  it('keeps a dot that is punctuation, not a separator', () => {
    assert.equal(parseSeriesFolder('Mr. Robot S01-S04 Complete 1080p').title, 'Mr. Robot');
    assert.equal(parseSeriesFolder('S.W.A.T. 2017 S01 1080p').title, 'S.W.A.T.');
    assert.equal(
      parseSeriesFolder('Agents of S.H.I.E.L.D. S01 1080p').title,
      'Agents of S.H.I.E.L.D.'
    );
  });

  /** The scene form still has to collapse, or every dotted name breaks. */
  it('still treats dots as separators when there are no spaces', () => {
    assert.equal(parseSeriesFolder('Mr.Robot.S01.1080p.WEB-DL').title, 'Mr Robot');
  });

  it('leaves other punctuation alone', () => {
    assert.equal(parseSeriesFolder("Bob's Burgers S01 1080p").title, "Bob's Burgers");
    assert.equal(parseSeriesFolder('Brooklyn Nine-Nine S01 1080p').title, 'Brooklyn Nine-Nine');
    assert.equal(parseSeriesFolder('9-1-1 S01 1080p').title, '9-1-1');
    assert.equal(parseSeriesFolder('Kaguya-sama: Love Is War S01').title, 'Kaguya-sama: Love Is War');
  });

  /**
   * A bracket at the front is a release tag. The trailing-bracket strip cannot
   * tell the two apart, so a leading group emptied the title and the fallback
   * returned the whole raw folder name.
   */
  it('drops a leading release group instead of the whole title', () => {
    assert.equal(parseSeriesFolder('[Group] Show Name S01 1080p').title, 'Show Name');
    assert.equal(parseSeriesFolder('[SubsPlease] Kaguya-sama S01 1080p').title, 'Kaguya-sama');
  });

  it('still drops trailing bracket groups', () => {
    const r = parseSeriesFolder('Show (2017) [1080p] S01');
    assert.equal(r.title, 'Show');
    assert.equal(r.year, 2017);
  });

  /** The two real shows in the library must not move. */
  it('leaves the existing library unchanged', () => {
    assert.deepEqual(parseSeriesFolder('Severance S01-S02 Complete 1080p'), {
      title: 'Severance',
      year: null
    });
    assert.deepEqual(
      parseSeriesFolder('Sherlock 2010 S01-S04 Complete 720p WEB-DL HEVC x265 BONE'),
      { title: 'Sherlock', year: 2010 }
    );
  });
});
