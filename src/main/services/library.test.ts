import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LibraryCatalog, LibraryItem } from '@shared/types';
import { withSubtitles, wouldDestroyMetadata } from './library-merge.js';

/** Only `metadata` matters to the guard; the rest is scaffolding. */
function catalog(metadataFlags: boolean[]): LibraryCatalog {
  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    roots: ['D:/Movies'],
    items: metadataFlags.map(
      (has, i) => ({ id: `film-${i}`, metadata: has ? ({ title: 'x' } as never) : null }) as LibraryItem
    )
  };
}

const ROOTS = ['D:/Movies'];

describe('wouldDestroyMetadata', () => {
  /**
   * The case this exists for: a rescan that comes back empty because the roots
   * were renamed or the id scheme changed would otherwise overwrite an enriched
   * catalog with a bare one.
   */
  it('refuses a merge that drops every scrap of metadata', () => {
    assert.equal(wouldDestroyMetadata(catalog([true, true]), catalog([false, false]), ROOTS), true);
  });

  it('allows a merge where some metadata survives', () => {
    assert.equal(wouldDestroyMetadata(catalog([true, true]), catalog([true, false]), ROOTS), false);
  });

  it('allows a first scan, which had no metadata to lose', () => {
    assert.equal(wouldDestroyMetadata(catalog([]), catalog([false, false]), ROOTS), false);
    assert.equal(wouldDestroyMetadata(catalog([false]), catalog([false]), ROOTS), false);
  });

  it('allows a merge that keeps everything', () => {
    assert.equal(wouldDestroyMetadata(catalog([true]), catalog([true]), ROOTS), false);
  });

  /**
   * Removing the last folder is a deliberate act. Without this the catalog
   * refuses to empty and the films stay on screen after the user removed the
   * only root they had, which reads as the remove button not working.
   */
  it('lets the catalog empty when no roots are configured', () => {
    assert.equal(wouldDestroyMetadata(catalog([true, true]), catalog([]), []), false);
  });

  it('still guards while a root remains', () => {
    assert.equal(wouldDestroyMetadata(catalog([true, true]), catalog([]), ROOTS), true);
  });
});

describe('withSubtitles', () => {
  const film = {
    id: 'a',
    folderPath: 'D:/Movies/Heat',
    subtitles: [],
    seasons: null
  } as unknown as LibraryItem;

  const show = {
    id: 'b',
    folderPath: 'D:/Series/Sherlock',
    subtitles: [],
    seasons: [
      {
        number: 1,
        label: 'Season 1',
        episodes: [
          { id: 'e1', folderPath: 'D:/Series/Sherlock/S01', video: { path: 'D:/Series/Sherlock/S01/ep1.mkv' }, subtitles: [] },
          { id: 'e2', folderPath: 'D:/Series/Sherlock/S01', video: { path: 'D:/Series/Sherlock/S01/ep2.mkv' }, subtitles: [] }
        ]
      }
    ]
  } as unknown as LibraryItem;

  const catalogOf = (items: LibraryItem[]): LibraryCatalog =>
    ({ schemaVersion: 1, scannedAt: '', roots: [], items }) as LibraryCatalog;

  it('records subtitles against a film by its folder', () => {
    const subs = [{ path: 'D:/Movies/Heat/heat.srt', label: 'English' }];
    const { catalog, changed } = withSubtitles(catalogOf([film]), 'D:/Movies/Heat', subs);
    assert.equal(changed, true);
    assert.deepEqual(catalog.items[0]?.subtitles, subs);
  });

  /** A season folder sweep must not hand every episode the others' tracks. */
  it('gives each episode only the files matching its own name', () => {
    const subs = [
      { path: 'D:/Series/Sherlock/S01/ep1.eng.srt', label: 'English' },
      { path: 'D:/Series/Sherlock/S01/ep2.eng.srt', label: 'English' }
    ];
    const { catalog } = withSubtitles(catalogOf([show]), 'D:/Series/Sherlock/S01', subs);
    const episodes = catalog.items[0]?.seasons?.[0]?.episodes ?? [];
    assert.deepEqual(episodes[0]?.subtitles.map((s) => s.path), [subs[0]?.path]);
    assert.deepEqual(episodes[1]?.subtitles.map((s) => s.path), [subs[1]?.path]);
  });

  it('reports no change when nothing matches the folder', () => {
    const { changed } = withSubtitles(catalogOf([film]), 'D:/Elsewhere', []);
    assert.equal(changed, false);
  });

  it('matches case-insensitively, as Windows paths do', () => {
    const { changed } = withSubtitles(catalogOf([film]), 'd:/movies/HEAT', []);
    assert.equal(changed, true);
  });
});
