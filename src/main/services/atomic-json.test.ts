import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { JsonReadError, readJsonOrFail, readJsonSafe, writeJsonAtomic } from './atomic-json.js';

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'movie-app-test-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeJsonAtomic', () => {
  it('writes and reads back', async () => {
    const path = join(dir, 'basic.json');
    await writeJsonAtomic(path, { hello: 'world' });
    assert.deepEqual(await readJsonSafe(path, null), { hello: 'world' });
  });

  it('creates missing parent directories', async () => {
    const path = join(dir, 'nested', 'deep', 'file.json');
    await writeJsonAtomic(path, { ok: true });
    assert.deepEqual(await readJsonSafe(path, null), { ok: true });
  });

  it('overwrites an existing file', async () => {
    const path = join(dir, 'over.json');
    await writeJsonAtomic(path, { v: 1 });
    await writeJsonAtomic(path, { v: 2 });
    assert.deepEqual(await readJsonSafe(path, null), { v: 2 });
  });

  /** The enriched catalog is multi-megabyte; make sure size is not the limit. */
  it('handles a catalog-sized payload', async () => {
    const path = join(dir, 'big.json');
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `id-${i}`,
      overview: 'x'.repeat(1200),
      cast: Array.from({ length: 30 }, (_, c) => ({ name: `Person ${c}`, character: 'Role' }))
    }));

    await writeJsonAtomic(path, { items });
    const back = await readJsonSafe<{ items: unknown[] }>(path, { items: [] });
    assert.equal(back.items.length, 200);
  });

  it('leaves no .tmp file behind', async () => {
    const path = join(dir, 'clean.json');
    await writeJsonAtomic(path, { a: 1 });
    assert.equal(await readJsonSafe(`${path}.tmp`, 'missing'), 'missing');
  });

  it('rejects rather than silently losing data when the payload is unserialisable', async () => {
    const path = join(dir, 'cyclic.json');
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    await assert.rejects(() => writeJsonAtomic(path, cyclic));
  });
});

describe('readJsonSafe', () => {
  it('falls back when the file is missing', async () => {
    assert.equal(await readJsonSafe(join(dir, 'nope.json'), 'fallback'), 'fallback');
  });

  it('falls back when the file is corrupt', async () => {
    const path = join(dir, 'corrupt.json');
    await writeFile(path, '{ not json', 'utf8');
    assert.equal(await readJsonSafe(path, 'fallback'), 'fallback');
  });
});

describe('readJsonOrFail', () => {
  it('returns the fallback when the file is missing', async () => {
    assert.equal(await readJsonOrFail(join(dir, 'absent.json'), 'fallback'), 'fallback');
  });

  it('reads a present file normally', async () => {
    const path = join(dir, 'present.json');
    await writeJsonAtomic(path, { v: 7 });
    assert.deepEqual(await readJsonOrFail(path, null), { v: 7 });
  });

  /**
   * The distinction that matters: a corrupt file must NOT look like an empty
   * one, or callers will happily write fresh data over it.
   */
  it('throws when the file exists but is corrupt', async () => {
    const path = join(dir, 'broken.json');
    await writeFile(path, '{ truncated', 'utf8');
    await assert.rejects(() => readJsonOrFail(path, 'fallback'), JsonReadError);
  });
});
