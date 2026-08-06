import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import { audioNeedsTranscode, headerNeedsTranscode } from './audio-support.js';

/**
 * The real sample library. The show is the reason this module exists: its
 * episodes are AAC and play untouched, while the Unaired Pilot carries AC-3
 * and does not.
 */
const SHOW = 'D:/Series/Sherlock 2010 S01-S04 Complete 720p WEB-DL HEVC x265 BONE';
const AAC_EPISODE = `${SHOW}/S01/Sherlock.S01E01.A.Study.in.Pink.720p.WEB-DL.HEVC.x265-BONE.mkv`;
const AC3_EPISODE = `${SHOW}/Unaired Pilot/Sherlock.S01E00.720p.BluRay.x264-ITSat.mkv`;

describe('headerNeedsTranscode', () => {
  it('flags the codecs Chromium cannot decode', () => {
    for (const id of ['A_AC3', 'A_EAC3', 'A_DTS', 'A_TRUEHD', 'A_MLP']) {
      assert.equal(headerNeedsTranscode(`...${id}...`), true, id);
    }
  });

  /** Converting a file that already plays would waste minutes and disk. */
  it('leaves codecs that already play alone', () => {
    for (const id of ['A_AAC', 'A_OPUS', 'A_VORBIS', 'A_FLAC', 'A_MPEG/L3']) {
      assert.equal(headerNeedsTranscode(`...${id}...`), false, id);
    }
  });

  /**
   * HEVC and Matroska were both assumed unplayable and both turned out to work
   * on this Electron. Neither may creep onto the list.
   */
  it('does not flag video codecs or containers', () => {
    assert.equal(headerNeedsTranscode('V_MPEGH/ISO/HEVC matroska A_AAC'), false);
  });
});

/**
 * These read the real library, which only exists on the developer's machine.
 * CI has no `D:/Series`, and an unreadable file reports "no transcode needed" —
 * so without this the AC-3 expectation fails on a runner rather than catching a
 * real regression. The logic itself is covered by `headerNeedsTranscode` above,
 * which needs no files at all.
 */
const HAS_LIBRARY = existsSync(AC3_EPISODE);

describe('audioNeedsTranscode', { skip: HAS_LIBRARY ? false : 'sample library not present' }, () => {
  it('leaves an AAC episode untouched', async () => {
    assert.equal(await audioNeedsTranscode(AAC_EPISODE), false);
  });

  it('flags the AC-3 pilot', async () => {
    assert.equal(await audioNeedsTranscode(AC3_EPISODE), true);
  });

  /** A missing file is the player's problem to report, not a conversion. */
  it('says no for a file it cannot read', async () => {
    assert.equal(await audioNeedsTranscode('D:/nope/missing.mkv'), false);
  });
});
