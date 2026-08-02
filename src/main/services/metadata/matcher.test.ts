import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUTO_ACCEPT } from '@shared/constants';
import { decideMatch, normalizeTitle, type Candidate } from './matcher.js';

function candidate(
  title: string,
  year: number | null,
  extra: Partial<Candidate> = {}
): Candidate {
  return {
    id: extra.id ?? 1,
    title,
    originalTitle: extra.originalTitle ?? title,
    year,
    popularity: extra.popularity ?? 10
  };
}

describe('normalizeTitle', () => {
  it('folds case, accents and punctuation', () => {
    assert.equal(normalizeTitle('Amélie'), 'amelie');
    assert.equal(normalizeTitle('Spider-Man: Homecoming'), 'spider man homecoming');
    assert.equal(normalizeTitle('Fast & Furious'), 'fast and furious');
  });
});

describe('decideMatch', () => {
  it('accepts an exact title and year', () => {
    const d = decideMatch('Interstellar', 2014, [candidate('Interstellar', 2014)]);
    assert.equal(d.accepted, true);
    assert.equal(d.best?.strategy, 'exact');
    assert.equal(d.best?.score, 1);
  });

  // The library has three misspelled folder names; all must still resolve.
  it('accepts through a typo — American Psyco → American Psycho', () => {
    const d = decideMatch('American Psyco', 2000, [candidate('American Psycho', 2000)]);
    assert.equal(d.accepted, true, `scored ${d.best?.score}`);
  });

  it('accepts through a typo — The Day After Tomarrow → Tomorrow', () => {
    const d = decideMatch('The Day After Tomarrow', 2004, [
      candidate('The Day After Tomorrow', 2004)
    ]);
    assert.equal(d.accepted, true, `scored ${d.best?.score}`);
  });

  it('accepts a junk suffix — Kingsman The Secret Service Revealed', () => {
    const d = decideMatch('Kingsman The Secret Service Revealed', 2015, [
      candidate('Kingsman: The Secret Service', 2014)
    ]);
    assert.equal(d.accepted, true, `scored ${d.best?.score}`);
  });

  it('accepts a junk prefix — James Bond Casino Royale', () => {
    const d = decideMatch('James Bond Casino Royale', 2006, [candidate('Casino Royale', 2006)]);
    assert.equal(d.accepted, true, `scored ${d.best?.score}`);
  });

  it('matches on the original title — Affeksjonsverdi', () => {
    const d = decideMatch('Affeksjonsverdi', 2025, [
      candidate('Sentimental Value', 2025, { originalTitle: 'Affeksjonsverdi' })
    ]);
    assert.equal(d.accepted, true, `scored ${d.best?.score}`);
  });

  it('accepts a known title when the folder has no year', () => {
    const d = decideMatch('Iron Man', null, [candidate('Iron Man', 2008)]);
    assert.equal(d.accepted, true);
    assert.equal(d.best?.strategy, 'title-year');
  });

  it('keeps a numeric title distinct from its year', () => {
    const d = decideMatch('2012', 2009, [candidate('2012', 2009)]);
    assert.equal(d.accepted, true);
    assert.equal(d.best?.strategy, 'exact');
  });

  // Guard rails: these must NOT sail through unattended.
  it('flags a same-title film from the wrong decade', () => {
    const d = decideMatch('Heat', 1995, [candidate('Heat', 2015)]);
    assert.equal(d.accepted, false, `scored ${d.best?.score}`);
    assert.equal(d.needsReview, true);
  });

  it('does not accept a short title swallowed by a longer one', () => {
    const d = decideMatch('Heat', 1995, [candidate('Heat of the Night', 1995)]);
    assert.equal(d.accepted, false, `scored ${d.best?.score}`);
  });

  it('rejects an unrelated film outright', () => {
    const d = decideMatch('Interstellar', 2014, [candidate('Interceptor', 2022)]);
    assert.equal(d.best, null);
    assert.equal(d.needsReview, true);
  });

  it('reports no match when the provider returns nothing', () => {
    const d = decideMatch('Soranin', 2010, []);
    assert.equal(d.best, null);
    assert.equal(d.accepted, false);
    assert.equal(d.needsReview, true);
  });

  it('prefers the correct year over a more popular wrong year', () => {
    const d = decideMatch('Iron Man', 2008, [
      candidate('Iron Man', 2013, { id: 2, popularity: 500 }),
      candidate('Iron Man', 2008, { id: 1, popularity: 20 })
    ]);
    assert.equal(d.best?.candidate.id, 1);
    assert.equal(d.accepted, true);
  });

  it('breaks ties on popularity', () => {
    const d = decideMatch('Cure', 1997, [
      candidate('Cure', 1997, { id: 9, popularity: 3 }),
      candidate('Cure', 1997, { id: 7, popularity: 40 })
    ]);
    assert.equal(d.best?.candidate.id, 7);
  });

  it('offers runners-up for the re-match UI', () => {
    const d = decideMatch('Star Trek', 2009, [
      candidate('Star Trek', 2009, { id: 1 }),
      candidate('Star Trek Beyond', 2016, { id: 2 }),
      candidate('Star Trek Into Darkness', 2013, { id: 3 })
    ]);
    assert.equal(d.best?.candidate.id, 1);
    assert.ok(d.alternatives.length >= 1);
    assert.ok(d.alternatives.every((a) => a.candidate.id !== 1));
  });

  it('never auto-accepts below the threshold', () => {
    const d = decideMatch('Soranin', 2010, [candidate('Solanin', 2010)]);
    if (d.accepted) assert.ok((d.best?.score ?? 0) >= AUTO_ACCEPT);
  });
});
