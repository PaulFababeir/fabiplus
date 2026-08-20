import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { Season } from '@shared/types';
import { scanLibrary } from './scanner.js';

/**
 * Season resolution, against a folder tree shaped like the ones that actually
 * come out of a torrent client. Built in a temp directory rather than read from
 * `D:/Series`, so it runs anywhere — the naming is what is under test, not the
 * developer's disk.
 */
describe('collectSeasons', () => {
  let root: string;
  let seasons: Season[];

  const label = (n: number | null): string | undefined =>
    seasons.find((s) => s.number === n)?.label;
  const episodes = (l: string): number[] =>
    (seasons.find((s) => s.label === l)?.episodes ?? []).map((e) => e.number ?? -1);

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'movie-app-scan-'));
    const show = join(root, 'Testshow 2020 S01-S02 Complete 1080p');

    const put = async (folder: string, ...files: string[]): Promise<void> => {
      await mkdir(join(show, folder), { recursive: true });
      for (const f of files) await writeFile(join(show, folder, f), '');
    };

    await put('S01', 'Testshow.S01E01.Pilot.1080p.mkv', 'Testshow.S01E02.Second.1080p.mkv');
    // The case that started this: the folder is just the release name.
    await put(
      'Testshow.S02.1080p.WEB.h264-ETHEL',
      'Testshow.S02E01.1080p.WEB.h264-ETHEL.mkv',
      'Testshow.S02E02.1080p.WEB.h264-ETHEL.mkv'
    );
    await put('Unaired Pilot', 'Testshow.S01E00.720p.BluRay.mkv');
    await put('Extras', 'Testshow.S00E01.Behind.The.Scenes.mkv');

    const scan = await scanLibrary([], [root]);
    seasons = scan.items[0]?.seasons ?? [];
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads the show itself', () => {
    assert.ok(seasons.length > 0, 'no seasons were produced at all');
  });

  /** The whole point: no renaming required for a release-named folder. */
  it('places a release-named folder by its season marker', () => {
    assert.equal(label(2), 'Season 2');
    assert.deepEqual(episodes('Season 2'), [1, 2]);
  });

  it('still reads a plainly named folder', () => {
    assert.equal(label(1), 'Season 1');
    assert.deepEqual(episodes('Season 1'), [1, 2]);
  });

  /** `Extras` has no number in its name; its one file says S00. */
  it('files specials as season zero', () => {
    assert.equal(label(0), 'Specials');
  });

  /**
   * The guard. The pilot's file is `S01E00`, so the files alone would fold it
   * into season 1 — but a folder called `S01` already claims that, so this is
   * something else and keeps the name the release author gave it.
   */
  it('keeps an unnumbered folder separate when a named folder owns that season', () => {
    const pilot = seasons.find((s) => s.label === 'Unaired Pilot');
    assert.ok(pilot, 'the Unaired Pilot folder was swallowed');
    assert.equal(pilot.number, null);
    assert.deepEqual(episodes('Unaired Pilot'), [0]);
  });

  it('sorts numbered seasons first and in order', () => {
    assert.deepEqual(
      seasons.map((s) => s.number),
      [0, 1, 2, null]
    );
  });
});
