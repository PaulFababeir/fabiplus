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

export class JsonReadError extends Error {
  constructor(readonly path: string, readonly cause: unknown) {
    super(`Could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'JsonReadError';
  }
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

/**
 * Like `readJsonSafe`, but only treats a *missing* file as the fallback case.
 * A file that exists and cannot be read or parsed throws.
 *
 * This distinction matters: swallowing a read error and returning an empty
 * value lets the caller conclude "there is nothing here yet" and then write
 * fresh empty data over a perfectly good file. Losing a catalog to a
 * transient read failure is far worse than surfacing the failure.
 */
export async function readJsonOrFail<T>(path: string, fallbackWhenMissing: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (isMissing(err)) return fallbackWhenMissing;
    throw new JsonReadError(path, err);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new JsonReadError(path, err);
  }
}
