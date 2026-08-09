import { createHash } from 'node:crypto';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CachedImage } from '@shared/types';
import { imageCacheDir } from './config.js';
import type { RemoteImage } from './metadata/provider.js';

/**
 * Downloads artwork once and keeps it on disk, so the library renders with no
 * network after the first enrichment pass. This is what makes the app
 * genuinely offline rather than merely offline-tolerant.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministic local name derived from the **full URL**, so re-running
 * enrichment reuses what is already downloaded instead of refetching.
 *
 * The URL and not the provider path, because the path alone does not say what
 * was fetched. TMDB encodes the size in the URL (`/w780/abc.jpg` against
 * `/original/abc.jpg`), so keying on the path meant a change of `BACKDROP_SIZE`
 * found the old file already present and kept serving the smaller image — the
 * new size would never arrive, however many times the user refetched. Every
 * size is now its own entry; the superseded ones are orphans in a cache that is
 * disposable by design.
 */
export function cacheFileName(url: string): string {
  const digest = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const ext = /\.([a-z0-9]{2,4})$/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
  return `${digest}.${ext}`;
}

export type ImageKind = 'poster' | 'backdrop' | 'still';

/**
 * Where each kind is cached. Filenames are SHA-1 digests of the provider path,
 * so a hostile `remotePath` cannot escape the directory.
 */
const SUBDIR: Record<ImageKind, string> = {
  poster: 'posters',
  backdrop: 'backdrops',
  still: 'stills'
};

export function cachePathFor(url: string, kind: ImageKind): string {
  return join(imageCacheDir(), SUBDIR[kind], cacheFileName(url));
}

/**
 * Fetches one image unless it is already cached. Written to a temp file and
 * renamed so an interrupted download can never leave a half-image that later
 * runs would treat as complete.
 */
export async function cacheImage(
  image: Pick<RemoteImage, 'path' | 'width' | 'height'>,
  kind: ImageKind,
  url: string,
  fetchImpl?: FetchLike
): Promise<CachedImage | null> {
  const localPath = cachePathFor(url, kind);

  if (await exists(localPath)) {
    return { remotePath: image.path, localPath, width: image.width, height: image.height };
  }

  const doFetch = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));

  try {
    const response = await doFetch(url);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) return null;

    await mkdir(join(localPath, '..'), { recursive: true });
    const tmp = `${localPath}.part`;
    await writeFile(tmp, buffer);
    await rename(tmp, localPath);

    return { remotePath: image.path, localPath, width: image.width, height: image.height };
  } catch {
    // A missing image is not worth failing the whole enrichment run over.
    return null;
  }
}

