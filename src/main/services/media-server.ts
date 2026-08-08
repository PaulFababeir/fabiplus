import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

/**
 * Serves local files to the renderer with HTTP range support.
 *
 * Range handling is what makes video seeking work at all: `net.fetch` on a
 * file:// URL returns the whole file and ignores the Range header, so the
 * <video> element cannot jump to an arbitrary timestamp — it would have to
 * download a 2GB file to reach the last minute.
 */

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  // Profile avatars accept whatever the picture chooser offers, so these two
  // reach the server even though no cached artwork is ever in either format.
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain'
};

export function contentTypeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export interface ParsedRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range `bytes=` header against a known file size.
 * Returns null for an absent or unsatisfiable header, in which case the
 * caller should serve the whole file.
 *
 * Handles the suffix form (`bytes=-500`, the last 500 bytes) and an open end
 * (`bytes=1000-`), both of which browsers use while scrubbing.
 */
export function parseRange(header: string | null, size: number): ParsedRange | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  const hasStart = rawStart !== '';
  const hasEnd = rawEnd !== '';
  if (!hasStart && !hasEnd) return null;

  let start: number;
  let end: number;

  if (!hasStart) {
    // Suffix form: the final N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = hasEnd ? Number(rawEnd) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;

  return { start, end: Math.min(end, size - 1) };
}

/**
 * Builds the response for a validated absolute path. Emits 206 with a
 * Content-Range when the client asked for a slice, 200 otherwise.
 */
export async function serveFile(path: string, rangeHeader: string | null): Promise<Response> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const type = contentTypeFor(path);
  const range = parseRange(rangeHeader, size);

  if (!range) {
    // `Accept-Ranges` is what tells the video element seeking is possible.
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    });
  }

  const { start, end } = range;
  const stream = Readable.toWeb(
    createReadStream(path, { start, end })
  ) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes'
    }
  });
}
