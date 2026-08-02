import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isHdrTagged,
  parseColrBox,
  TRANSFER_BT709,
  TRANSFER_HLG,
  TRANSFER_PQ,
  UNTAGGED
} from './video-colour.js';

/** Builds a minimal box the parser can find inside surrounding noise. */
function colrBox(
  kind: 'nclx' | 'nclc',
  primaries: number,
  transfer: number,
  matrix: number,
  fullRange = false
): Buffer {
  const body = Buffer.alloc(kind === 'nclx' ? 11 : 10);
  body.write(kind, 0, 'latin1');
  body.writeUInt16BE(primaries, 4);
  body.writeUInt16BE(transfer, 6);
  body.writeUInt16BE(matrix, 8);
  if (kind === 'nclx') body.writeUInt8(fullRange ? 0x80 : 0x00, 10);

  return Buffer.concat([Buffer.from('....mdatnoise', 'latin1'), Buffer.from('colr', 'latin1'), body]);
}

describe('parseColrBox', () => {
  /** Exactly what the F1 release in the library declares. */
  it('reads an HDR10 tag (PQ / BT.2020)', () => {
    const colour = parseColrBox(colrBox('nclx', 9, 16, 9));
    assert.equal(colour.primaries, 9);
    assert.equal(colour.transfer, TRANSFER_PQ);
    assert.equal(colour.matrix, 9);
    assert.equal(colour.fullRange, false);
  });

  it('reads a plain BT.709 tag', () => {
    const colour = parseColrBox(colrBox('nclx', 1, 1, 1));
    assert.equal(colour.transfer, TRANSFER_BT709);
    assert.equal(colour.primaries, 1);
  });

  it('reads the full-range flag', () => {
    assert.equal(parseColrBox(colrBox('nclx', 1, 1, 1, true)).fullRange, true);
    assert.equal(parseColrBox(colrBox('nclx', 1, 1, 1, false)).fullRange, false);
  });

  /** The older box has no range byte and is always limited range. */
  it('treats nclc as limited range', () => {
    assert.equal(parseColrBox(colrBox('nclc', 1, 1, 1)).fullRange, false);
  });

  it('returns untagged when there is no colr box', () => {
    assert.deepEqual(parseColrBox(Buffer.from('ftypisommdat....', 'latin1')), UNTAGGED);
  });

  /** ICC-profile colr boxes carry no nclx fields to read. */
  it('ignores a colr box of an unknown type', () => {
    const buf = Buffer.concat([
      Buffer.from('colr', 'latin1'),
      Buffer.from('prof', 'latin1'),
      Buffer.alloc(16)
    ]);
    assert.deepEqual(parseColrBox(buf), UNTAGGED);
  });

  it('does not read past a truncated box', () => {
    assert.deepEqual(parseColrBox(Buffer.from('colrnclx', 'latin1')), UNTAGGED);
  });
});

describe('isHdrTagged', () => {
  it('flags PQ and HLG', () => {
    assert.equal(isHdrTagged({ ...UNTAGGED, transfer: TRANSFER_PQ }), true);
    assert.equal(isHdrTagged({ ...UNTAGGED, transfer: TRANSFER_HLG }), true);
  });

  it('leaves SDR and untagged files alone', () => {
    assert.equal(isHdrTagged({ ...UNTAGGED, transfer: TRANSFER_BT709 }), false);
    assert.equal(isHdrTagged(UNTAGGED), false);
  });
});
