import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseReleaseName, subtitleLabel } from './filename-parser.js';

/**
 * Every case below is a real folder or file name from the library this app was
 * built against. The tricky ones are called out — they are the parses that
 * broke first.
 */
describe('parseReleaseName', () => {
  const cases: Array<{ raw: string; title: string; year: number | null; why?: string }> = [
    { raw: '10 Things I Hate About You (1999) [1080p]', title: '10 Things I Hate About You', year: 1999 },
    {
      raw: '2012 (2009) [1080p]',
      title: '2012',
      year: 2009,
      why: 'a numeric title must not be eaten as the year'
    },
    { raw: '21 Jump Street (2012) [1080p]', title: '21 Jump Street', year: 2012 },
    {
      raw: '500 Days Of Summer (2009) [REPACK] [1080p] [BluRay] [5.1] [YTS.MX]',
      title: '500 Days Of Summer',
      year: 2009
    },
    {
      raw: 'Uncut Gems (2019) [1080p] [BluRay] [5.1] [YTS.MX]',
      title: 'Uncut Gems',
      year: 2019,
      why: '"Uncut" is a release flag but also the title here'
    },
    {
      raw: 'A Walk to Remember (2002) [1080p]',
      title: 'A Walk to Remember',
      year: 2002,
      why: '"to" is a TLD fragment in scene URLs but a word here'
    },
    {
      raw: 'How To Lose A Guy In 10 Days (2003) [1080p]',
      title: 'How To Lose A Guy In 10 Days',
      year: 2003,
      why: 'same "to" trap, plus a bare number that is not a year'
    },
    {
      raw: 'Iron Man [1080p]',
      title: 'Iron Man',
      year: null,
      why: 'no year anywhere in the folder name'
    },
    {
      raw: 'American Psyco (2000) 1080p',
      title: 'American Psyco',
      year: 2000,
      why: 'unbracketed trailing tag; title typo is preserved verbatim'
    },
    {
      raw: 'Captain America - The First Avenger (2011)',
      title: 'Captain America - The First Avenger',
      year: 2011
    },
    {
      raw: 'Guardians Of The Galaxy Vol. 2 (2017) [1080p] [YTS.AG]',
      title: 'Guardians Of The Galaxy Vol. 2',
      year: 2017,
      why: 'dots inside a title must not be treated as separators'
    },
    {
      raw: 'Obsession (2025) [1080p] [WEBRip] [5.1] [YTS.GG - YTS.BZ]',
      title: 'Obsession',
      year: 2025,
      why: 'two release groups in one bracket'
    },
    {
      raw: 'Oppenheimer (2023) [1080p] [BluRay] [x265] [10bit] [5.1] [YTS.MX]',
      title: 'Oppenheimer',
      year: 2023
    },
    {
      raw: 'Project Hail Mary (2026) [2160p] [4K] [WEB] [5.1] [YTS.BZ]',
      title: 'Project Hail Mary',
      year: 2026,
      why: 'future-dated release must stay in range'
    },
    {
      raw: 'Interstellar.2014.2014.1080p.BluRay.x264.YIFY.mp4',
      title: 'Interstellar',
      year: 2014,
      why: 'dot-separated filename with a duplicated year'
    },
    {
      raw: 'Affeksjonsverdi (2025) [HYBRID] [1080p] [BluRay] [5.1] [YTS.BZ]',
      title: 'Affeksjonsverdi',
      year: 2025
    },
    {
      raw: 'Kingsman The Secret Service Revealed (2015) [BLU-RAY] [1080p] [BluRay] [5.1] [YTS.MX]',
      title: 'Kingsman The Secret Service Revealed',
      year: 2015,
      why: 'junk word "Revealed" is left in — the matcher deals with it, not the parser'
    },
    {
      raw: 'Drive (2011) [2160p] [4K] [BluRay] [5.1] [YTS.MX]',
      title: 'Drive',
      year: 2011
    }
  ];

  for (const { raw, title, year, why } of cases) {
    it(`${raw}${why ? ` — ${why}` : ''}`, () => {
      const parsed = parseReleaseName(raw);
      assert.equal(parsed.title, title);
      assert.equal(parsed.year, year);
    });
  }

  it('never returns an empty title for a non-empty name', () => {
    for (const raw of ['[1080p]', 'UNRATED', '(2019)', '1080p BluRay YTS.MX']) {
      assert.notEqual(parseReleaseName(raw).title, '', `empty title for "${raw}"`);
    }
  });

  it('converts " - " to a colon for provider lookup', () => {
    const parsed = parseReleaseName('Captain America - The First Avenger (2011)');
    assert.equal(parsed.searchTitle, 'Captain America: The First Avenger');
  });

  it('captures release tags rather than discarding them', () => {
    const { tags } = parseReleaseName(
      'Weapons (2025) [1080p] [WEBRip] [x265] [10bit] [5.1] [YTS.MX]'
    );
    assert.equal(tags.resolution, '1080p');
    assert.equal(tags.source, 'WEBRip');
    assert.equal(tags.codec, 'x265');
    assert.equal(tags.bitDepth, '10bit');
    assert.equal(tags.group, 'YTS.MX');
  });

  it('keeps REPACK and HYBRID as flags', () => {
    assert.ok(parseReleaseName('X (2009) [REPACK] [1080p]').tags.flags.includes('REPACK'));
    assert.ok(parseReleaseName('Y (2025) [HYBRID] [1080p]').tags.flags.includes('HYBRID'));
  });
});

describe('subtitleLabel', () => {
  it('reads a language suffix', () => {
    assert.equal(subtitleLabel('Parasite (2019) [BluRay] [1080p] [YTS.LT]-English.srt'), 'English');
  });

  it('falls back when there is no suffix', () => {
    assert.equal(subtitleLabel('Interstellar.2014.1080p.BluRay.x264.YIFY.srt'), 'Default');
  });
});
