import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CachedImage, LibraryCatalog, LibraryItem, ScanResult } from '@shared/types';
import {
  mergeScan,
  withBackdropFull,
  withSubtitles,
  wouldDestroyMetadata
} from './library-merge.js';

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

/**
 * A rescan used to take `seasons` straight off the scan, which silently threw
 * away every episode runtime, recovered title and still — none of which a scan
 * can know — and left no way back short of a full refetch.
 */
describe('mergeScan and episode enrichment', () => {
  const still: CachedImage = {
    remotePath: '/still.jpg',
    localPath: 'D:/cache/stills/abc.jpg',
    width: 0,
    height: 0
  };

  const showAs = (episodes: unknown[]): LibraryItem =>
    ({
      id: 'show',
      kind: 'series',
      folderPath: 'D:/Series/Sherlock',
      addedAt: '2026-01-01T00:00:00.000Z',
      metadata: { title: 'Sherlock' },
      match: { strategy: 'fuzzy', confidence: 0.9, correctedByUser: false },
      seasons: [{ number: 1, label: 'Season 1', episodes }]
    }) as unknown as LibraryItem;

  /** What enrichment left behind. */
  const stored = showAs([
    { id: 'e1', number: 1, title: 'A Study in Pink', runtimeMin: 88, still }
  ]);

  /** What a fresh scan of the same folder produces. */
  const scanned = showAs([{ id: 'e1', number: 1, title: null, runtimeMin: null, still: null }]);

  const scanOf = (items: LibraryItem[]): ScanResult =>
    ({ items, issues: [], durationMs: 0 }) as ScanResult;

  const catalogOf = (items: LibraryItem[]): LibraryCatalog =>
    ({ schemaVersion: 1, scannedAt: '', roots: ROOTS, items }) as LibraryCatalog;

  it('carries provider data across a rescan', () => {
    const merged = mergeScan(catalogOf([stored]), scanOf([scanned]), ROOTS);
    const episode = merged.items[0]?.seasons?.[0]?.episodes[0];

    assert.equal(episode?.title, 'A Study in Pink');
    assert.equal(episode?.runtimeMin, 88);
    assert.deepEqual(episode?.still, still);
  });

  /** The filename describes the file the user actually has, so it wins. */
  it('prefers a title the scan recovered from the filename', () => {
    const withTitle = showAs([
      { id: 'e1', number: 1, title: 'From The Filename', runtimeMin: null, still: null }
    ]);
    const merged = mergeScan(catalogOf([stored]), scanOf([withTitle]), ROOTS);
    assert.equal(merged.items[0]?.seasons?.[0]?.episodes[0]?.title, 'From The Filename');
  });

  /** Ids are path hashes, so a renamed file is a different episode. */
  it('does not hand a renamed file the old episode data', () => {
    const renamed = showAs([{ id: 'e9', number: 1, title: null, runtimeMin: null, still: null }]);
    const merged = mergeScan(catalogOf([stored]), scanOf([renamed]), ROOTS);
    const episode = merged.items[0]?.seasons?.[0]?.episodes[0];

    assert.equal(episode?.runtimeMin, null);
    assert.equal(episode?.still, null);
  });

  it('leaves a film alone', () => {
    const film = { id: 'f', seasons: null, addedAt: 'x' } as unknown as LibraryItem;
    const merged = mergeScan(catalogOf([film]), scanOf([film]), ROOTS);
    assert.equal(merged.items[0]?.seasons, null);
  });
});

/**
 * Only the default backdrop is fetched at full size; the other nineteen are
 * picker previews until one is actually chosen.
 */
describe('withBackdropFull', () => {
  const preview = (path: string): CachedImage => ({
    remotePath: path,
    localPath: `D:/cache/backdrops/${path}-w500.jpg`,
    width: 500,
    height: 281,
    fullPath: null
  });

  const film = (backdrops: CachedImage[]): LibraryItem =>
    ({
      id: 'a',
      metadata: { backdrops, backdrop: backdrops[0] ?? null }
    }) as unknown as LibraryItem;

  it('records the full path against the chosen backdrop', () => {
    const next = withBackdropFull(film([preview('/x'), preview('/y')]), 1, 'D:/full/y.jpg');
    assert.equal(next.metadata?.backdrops[1]?.fullPath, 'D:/full/y.jpg');
  });

  it('leaves the others alone', () => {
    const next = withBackdropFull(film([preview('/x'), preview('/y')]), 1, 'D:/full/y.jpg');
    assert.equal(next.metadata?.backdrops[0]?.fullPath, null);
  });

  /**
   * The legacy scalar *is* `backdrops[0]`, so upgrading index zero has to move
   * both — otherwise a catalog written before the list existed keeps serving
   * the preview through `metadata.backdrop`.
   */
  it('keeps the legacy scalar in step when the default is upgraded', () => {
    const next = withBackdropFull(film([preview('/x'), preview('/y')]), 0, 'D:/full/x.jpg');
    assert.equal(next.metadata?.backdrop?.fullPath, 'D:/full/x.jpg');
  });

  it('does not touch the scalar for any other index', () => {
    const next = withBackdropFull(film([preview('/x'), preview('/y')]), 1, 'D:/full/y.jpg');
    assert.equal(next.metadata?.backdrop?.fullPath, null);
  });

  /** Returning the same object is what lets the caller skip a catalog write. */
  it('returns the item unchanged when there is nothing to record', () => {
    const already = film([{ ...preview('/x'), fullPath: 'D:/full/x.jpg' }]);
    assert.equal(withBackdropFull(already, 0, 'D:/other.jpg'), already);

    const none = film([]);
    assert.equal(withBackdropFull(none, 3, 'D:/full/x.jpg'), none);
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
