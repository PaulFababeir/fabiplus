import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LibraryCatalog, LibraryItem } from '@shared/types';
import { wouldDestroyMetadata } from './library-merge.js';

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
