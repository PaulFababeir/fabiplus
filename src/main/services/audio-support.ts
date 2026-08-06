import { open } from 'node:fs/promises';

/**
 * Which audio Chromium refuses, and how to spot it.
 *
 * Apart from `transcode.ts` because that module reaches `config.ts` for the
 * cache location, which imports `electron` — nothing importing it can be loaded
 * by a test. This half is pure file reading, and it decides whether a file gets
 * converted at all, so it needs to be reachable without an Electron runtime.
 *
 * Measured against this Electron rather than assumed: HEVC video and the
 * Matroska container both play natively, so neither belongs on this list. AC-3
 * and its relatives are the real gap, and they are common in BluRay rips.
 */

/** Matroska codec IDs Chromium cannot decode. */
export const UNSUPPORTED_AUDIO = ['A_AC3', 'A_EAC3', 'A_DTS', 'A_TRUEHD', 'A_MLP'];

/** How much of the header to inspect. Track entries sit near the front. */
const HEADER_BYTES = 512 * 1024;

/** True when `header` advertises audio the player cannot decode. */
export function headerNeedsTranscode(header: string): boolean {
  return UNSUPPORTED_AUDIO.some((id) => header.includes(id));
}

/**
 * Reads the container header directly rather than shelling out to ffprobe: this
 * runs on every play, and spawning a process to answer "is this AC-3" costs
 * more than the read does.
 */
export async function audioNeedsTranscode(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    // latin1 keeps byte values intact, so ASCII codec IDs survive the decode.
    return headerNeedsTranscode(buffer.subarray(0, bytesRead).toString('latin1'));
  } catch {
    // Unreadable here means unplayable later; let the player report it.
    return false;
  } finally {
    await handle?.close();
  }
}
