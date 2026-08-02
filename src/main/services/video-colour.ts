import { open } from 'node:fs/promises';

/**
 * Reads the colour description an MP4 declares, so the player can tell when a
 * file claims to be HDR.
 *
 * This matters because Chromium honours the tag: a file marked PQ/BT.2020 gets
 * tone-mapped down for an SDR display, while VLC largely ignores the tag and
 * shows the values as graded. Release groups mislabel "HYBRID" encodes as HDR
 * fairly often, and the result is a picture that looks markedly darker here
 * than in VLC despite both decoding the same frames.
 */

/** ISO/IEC 23001-8 transfer characteristics we care about. */
export const TRANSFER_BT709 = 1;
export const TRANSFER_PQ = 16;
export const TRANSFER_HLG = 18;

export interface VideoColour {
  /** Transfer characteristics, or null when the file declares none. */
  transfer: number | null;
  primaries: number | null;
  matrix: number | null;
  /** False = limited/TV range (16-235). */
  fullRange: boolean;
}

export const UNTAGGED: VideoColour = {
  transfer: null,
  primaries: null,
  matrix: null,
  fullRange: false
};

/**
 * True when the declared transfer is a high-dynamic-range curve, meaning
 * Chromium will tone-map on an SDR display.
 */
export function isHdrTagged(colour: VideoColour): boolean {
  return colour.transfer === TRANSFER_PQ || colour.transfer === TRANSFER_HLG;
}

/**
 * Extracts the `colr` box from a chunk of an MP4.
 *
 * Deliberately a scan rather than a full box-tree walk: `colr` sits inside
 * stsd → avc1/hvc1, and a targeted search over the header region finds it
 * without implementing a parser for every container variant.
 */
export function parseColrBox(buffer: Buffer): VideoColour {
  const at = buffer.indexOf('colr', 0, 'latin1');
  if (at < 0 || at + 15 > buffer.length) return UNTAGGED;

  const kind = buffer.toString('latin1', at + 4, at + 8);
  if (kind !== 'nclx' && kind !== 'nclc') return UNTAGGED;

  const primaries = buffer.readUInt16BE(at + 8);
  const transfer = buffer.readUInt16BE(at + 10);
  const matrix = buffer.readUInt16BE(at + 12);

  // `nclc` predates the range flag and is always limited range.
  const fullRange = kind === 'nclx' ? (buffer.readUInt8(at + 14) & 0x80) !== 0 : false;

  return { transfer, primaries, matrix, fullRange };
}

/** How much of the file header to search; `colr` lives near the front. */
const PROBE_BYTES = 4 * 1024 * 1024;

export async function probeVideoColour(path: string): Promise<VideoColour> {
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, PROBE_BYTES, 0);
    return parseColrBox(buffer.subarray(0, bytesRead));
  } catch {
    // An unreadable header is not worth failing playback over.
    return UNTAGGED;
  } finally {
    await handle?.close();
  }
}
