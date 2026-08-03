import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildActivity, encodeFrame, pipePath } from './discord-presence.js';

describe('encodeFrame', () => {
  it('prefixes opcode and byte length as little-endian int32', () => {
    const frame = encodeFrame(1, { a: 1 });
    const json = JSON.stringify({ a: 1 });

    assert.equal(frame.readInt32LE(0), 1);
    assert.equal(frame.readInt32LE(4), Buffer.byteLength(json));
    assert.equal(frame.subarray(8).toString('utf8'), json);
  });

  /** Length is bytes, not characters — a title with accents would desync. */
  it('measures length in bytes, not characters', () => {
    const frame = encodeFrame(1, { t: 'Amélie ソラニン' });
    const body = frame.subarray(8);
    assert.equal(frame.readInt32LE(4), body.length);
    assert.deepEqual(JSON.parse(body.toString('utf8')), { t: 'Amélie ソラニン' });
  });
});

describe('pipePath', () => {
  it('uses the Windows named-pipe form', () => {
    if (process.platform !== 'win32') return;
    assert.equal(pipePath(0), '\\\\?\\pipe\\discord-ipc-0');
    assert.equal(pipePath(3), '\\\\?\\pipe\\discord-ipc-3');
  });
});

describe('buildActivity', () => {
  const base = { title: 'Interstellar', subtitle: '2014', remainingSec: null, largeImage: null };

  it('maps title and subtitle to the two visible lines', () => {
    const payload = buildActivity(base);
    assert.equal(payload['details'], 'Interstellar');
    assert.equal(payload['state'], '2014');
  });

  /** `end` is what makes Discord render a countdown rather than elapsed time. */
  it('sends an end timestamp so Discord shows time remaining', () => {
    const payload = buildActivity({ ...base, remainingSec: 600 });
    const stamps = payload['timestamps'] as { end: number };
    const expected = Date.now() + 600_000;
    assert.ok(Math.abs(stamps.end - expected) < 2000, `got ${stamps.end}`);
  });

  it('omits timestamps when the runtime is unknown', () => {
    assert.equal(buildActivity(base)['timestamps'], undefined);
    assert.equal(buildActivity({ ...base, remainingSec: 0 })['timestamps'], undefined);
  });

  it('omits an empty subtitle rather than sending a blank line', () => {
    assert.equal(buildActivity({ ...base, subtitle: '' })['state'], undefined);
  });

  it('only sends assets when an image key is configured', () => {
    assert.equal(buildActivity(base)['assets'], undefined);
    assert.deepEqual(buildActivity({ ...base, largeImage: 'poster' })['assets'], {
      large_image: 'poster',
      large_text: 'Interstellar'
    });
  });
});
