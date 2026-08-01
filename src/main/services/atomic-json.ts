import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes JSON via a temp file + rename so a crash mid-write cannot leave a
 * truncated file behind. Profile data is the only thing in this app that
 * cannot be regenerated from disk, so it must never be written in place.
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}

/** Reads JSON, returning `fallback` when the file is missing or corrupt. */
export async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
