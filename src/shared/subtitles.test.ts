import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isVtt, srtToVtt, subtitleFileName } from './subtitles.js';

describe('srtToVtt', () => {
  it('adds the WEBVTT header', () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:04,000\nHello\n');
    assert.ok(out.startsWith('WEBVTT\n\n'), out);
  });

  it('converts comma decimals to periods', () => {
    const out = srtToVtt('1\n00:00:01,500 --> 00:00:04,250\nHello\n');
    assert.ok(out.includes('00:00:01.500 --> 00:00:04.250'), out);
  });

  it('drops cue numbers but keeps the text', () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nFirst\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n');
    assert.ok(out.includes('First'));
    assert.ok(out.includes('Second'));
    assert.ok(!/^\s*1\s*$/m.test(out), 'cue number 1 should be gone');
  });

  /** A number that is actually dialogue must survive. */
  it('keeps a numeric line that is not a cue number', () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\n1999\n');
    assert.ok(out.includes('1999'));
  });

  it('normalises CRLF line endings', () => {
    const out = srtToVtt('1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n');
    assert.ok(!out.includes('\r'));
    assert.ok(out.includes('Hello'));
  });

  /** A BOM ahead of WEBVTT makes the whole file fail to parse. */
  it('strips a leading byte order mark', () => {
    const out = srtToVtt('﻿1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    assert.ok(out.startsWith('WEBVTT'), JSON.stringify(out.slice(0, 12)));
  });

  it('pads missing hours', () => {
    const out = srtToVtt('1\n01:02,000 --> 01:05,000\nHello\n');
    assert.ok(out.includes('00:01:02.000 --> 00:01:05.000'), out);
  });

  it('pads single-digit fields and short milliseconds', () => {
    const out = srtToVtt('1\n0:1:2,5 --> 0:1:3,25\nHello\n');
    assert.ok(out.includes('00:01:02.500 --> 00:01:03.250'), out);
  });

  it('handles hours beyond nine', () => {
    const out = srtToVtt('1\n10:00:00,000 --> 10:00:02,000\nLate\n');
    assert.ok(out.includes('10:00:00.000 --> 10:00:02.000'), out);
  });

  it('keeps inline styling tags, which WebVTT also supports', () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\n<i>Whispered</i>\n');
    assert.ok(out.includes('<i>Whispered</i>'));
  });

  /** SRT coordinate cues are not valid VTT settings and would break the cue. */
  it('drops SRT positioning coordinates', () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:600 Y1:400 Y2:450\nHello\n');
    assert.ok(out.includes('00:00:01.000 --> 00:00:02.000'));
    assert.ok(!out.includes('X1:'), out);
  });

  it('preserves multi-line cue text', () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nLine one\nLine two\n');
    assert.ok(out.includes('Line one\nLine two'));
  });

  it('collapses runs of blank lines', () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nHello\n\n\n\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n');
    assert.ok(!out.includes('\n\n\n'), JSON.stringify(out));
  });

  it('survives an empty file', () => {
    assert.equal(srtToVtt('').trim(), 'WEBVTT');
  });

  it('ends with a trailing newline', () => {
    assert.ok(srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nHi\n').endsWith('\n'));
  });
});

describe('isVtt', () => {
  it('detects a file that is already WebVTT', () => {
    assert.equal(isVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n'), true);
    assert.equal(isVtt('﻿WEBVTT\n'), true);
  });

  it('does not mistake SRT for VTT', () => {
    assert.equal(isVtt('1\n00:00:01,000 --> 00:00:02,000\nHi\n'), false);
  });
});

describe('subtitleFileName', () => {
  /**
   * Named so the existing scanner picks it up unaided: `shareStem` matches on
   * the video's stem, and `subtitleLabel` reads the trailing word as the label.
   */
  it('leads with the video stem and ends with the language', () => {
    assert.equal(
      subtitleFileName('Interstellar.2014.1080p.BluRay.x264.YIFY.mp4', 'English'),
      'Interstellar.2014.1080p.BluRay.x264.YIFY.English.srt'
    );
  });

  it('keeps a regional name readable', () => {
    assert.equal(
      subtitleFileName('Film.mkv', 'Portuguese (Brazil)'),
      'Film.Portuguese (Brazil).srt'
    );
  });

  /** The language comes off a scraped page, so it cannot be trusted as a path. */
  it('strips anything that could escape the folder', () => {
    assert.equal(subtitleFileName('Film.mkv', '../../evil'), 'Film.evil.srt');
    assert.equal(subtitleFileName('Film.mkv', 'a/b\\c'), 'Film.abc.srt');
    assert.equal(subtitleFileName('Film.mkv', '???'), 'Film.Downloaded.srt');
  });
});
