import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contentTypeFor, parseRange } from './media-server.js';

const SIZE = 1000;

describe('parseRange', () => {
  it('returns null without a header, so the whole file is served', () => {
    assert.equal(parseRange(null, SIZE), null);
  });

  it('parses a closed range', () => {
    assert.deepEqual(parseRange('bytes=0-499', SIZE), { start: 0, end: 499 });
  });

  /** Browsers open a stream this way and read until they have enough. */
  it('parses an open-ended range', () => {
    assert.deepEqual(parseRange('bytes=500-', SIZE), { start: 500, end: 999 });
  });

  /** Used to read the moov atom at the tail of a poorly muxed mp4. */
  it('parses a suffix range', () => {
    assert.deepEqual(parseRange('bytes=-200', SIZE), { start: 800, end: 999 });
  });

  it('clamps an end past the file size', () => {
    assert.deepEqual(parseRange('bytes=900-99999', SIZE), { start: 900, end: 999 });
  });

  it('clamps a suffix longer than the file', () => {
    assert.deepEqual(parseRange('bytes=-99999', SIZE), { start: 0, end: 999 });
  });

  it('rejects a start beyond the file', () => {
    assert.equal(parseRange('bytes=1000-', SIZE), null);
    assert.equal(parseRange('bytes=5000-6000', SIZE), null);
  });

  it('rejects an inverted range', () => {
    assert.equal(parseRange('bytes=800-200', SIZE), null);
  });

  it('rejects malformed headers rather than guessing', () => {
    for (const header of ['bytes=', 'bytes=abc-def', 'items=0-10', '0-10', 'bytes=-0']) {
      assert.equal(parseRange(header, SIZE), null, `should reject "${header}"`);
    }
  });

  it('tolerates surrounding whitespace', () => {
    assert.deepEqual(parseRange('  bytes=10-20  ', SIZE), { start: 10, end: 20 });
  });
});

describe('contentTypeFor', () => {
  it('maps the container types in the library', () => {
    assert.equal(contentTypeFor('D:/Movies/x/film.mp4'), 'video/mp4');
    assert.equal(contentTypeFor('D:/Movies/x/film.mkv'), 'video/x-matroska');
    assert.equal(contentTypeFor('D:/Movies/x/subs.vtt'), 'text/vtt');
    assert.equal(contentTypeFor('D:/Movies/x/poster.JPG'), 'image/jpeg');
  });

  it('falls back for unknown extensions', () => {
    assert.equal(contentTypeFor('D:/Movies/x/notes.xyz'), 'application/octet-stream');
  });
});
