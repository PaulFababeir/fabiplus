import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProviderError } from './provider.js';
import { TmdbProvider } from './tmdb.js';

/**
 * Exercises the provider against stubbed responses. Covers everything except
 * the live network hop: auth mode, query shape, field mapping and artwork
 * ranking.
 */

interface Call {
  url: string;
  headers: Record<string, string>;
}

function stub(responses: unknown[], status = 200): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;

  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, headers: (init?.headers as Record<string, string>) ?? {} });
    const body = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

describe('TmdbProvider auth', () => {
  it('puts a v3 key in the query string', async () => {
    const { fetch: f, calls } = stub([{ results: [] }]);
    await new TmdbProvider('abc123', f).search('Heat', 1995);
    assert.ok(calls[0]!.url.includes('api_key=abc123'));
    assert.equal(calls[0]!.headers['Authorization'], undefined);
  });

  it('puts a v4 read token in the Authorization header', async () => {
    const { fetch: f, calls } = stub([{ results: [] }]);
    await new TmdbProvider('eyJhbGciOiJIUzI1NiJ9.payload.sig', f).search('Heat', 1995);
    assert.ok(!calls[0]!.url.includes('api_key='));
    assert.ok(calls[0]!.headers['Authorization']?.startsWith('Bearer eyJ'));
  });

  it('refuses an empty key', () => {
    assert.throws(() => new TmdbProvider('   '), ProviderError);
  });
});

describe('TmdbProvider.search', () => {
  it('maps results and derives the year from the release date', async () => {
    const { fetch: f } = stub([
      {
        results: [
          {
            id: 157336,
            title: 'Interstellar',
            original_title: 'Interstellar',
            release_date: '2014-11-05',
            popularity: 120.5
          }
        ]
      }
    ]);

    const [first] = await new TmdbProvider('k', f).search('Interstellar', 2014);
    assert.equal(first?.id, 157336);
    assert.equal(first?.year, 2014);
    assert.equal(first?.popularity, 120.5);
  });

  it('retries without the year when a year-constrained search finds nothing', async () => {
    const { fetch: f, calls } = stub([{ results: [] }, { results: [{ id: 1, title: 'Kingsman' }] }]);

    const results = await new TmdbProvider('k', f).search('Kingsman', 2015);
    assert.equal(calls.length, 2);
    assert.ok(calls[0]!.url.includes('year=2015'));
    assert.ok(!calls[1]!.url.includes('year='));
    assert.equal(results.length, 1);
  });

  it('does not retry when the first search already found something', async () => {
    const { fetch: f, calls } = stub([{ results: [{ id: 1, title: 'Heat' }] }]);
    await new TmdbProvider('k', f).search('Heat', 1995);
    assert.equal(calls.length, 1);
  });

  it('handles a missing results array', async () => {
    const { fetch: f } = stub([{}]);
    assert.deepEqual(await new TmdbProvider('k', f).search('Nothing', null), []);
  });
});

describe('TmdbProvider.fetchDetails', () => {
  const details = {
    id: 157336,
    title: 'Interstellar',
    original_title: 'Interstellar',
    release_date: '2014-11-05',
    runtime: 169,
    tagline: '  Mankind was born on Earth.  ',
    overview: 'A team travels through a wormhole.',
    vote_average: 8.4,
    genres: [
      { id: 12, name: 'Adventure' },
      { id: 18, name: 'Drama' }
    ],
    credits: {
      cast: [
        { name: 'Matthew McConaughey', character: 'Cooper', order: 0, profile_path: '/a.jpg' },
        { name: 'Anne Hathaway', character: 'Brand', order: 1, profile_path: null }
      ],
      crew: [
        { name: 'Christopher Nolan', job: 'Director', department: 'Directing' },
        { name: 'Hans Zimmer', job: 'Original Music Composer', department: 'Sound' },
        { name: 'Someone', job: 'Best Boy Grip', department: 'Lighting' }
      ]
    },
    images: {
      posters: [
        { file_path: '/low.jpg', width: 500, height: 750, vote_average: 3, iso_639_1: 'en' },
        { file_path: '/best.jpg', width: 500, height: 750, vote_average: 9, iso_639_1: null },
        { file_path: '/fr.jpg', width: 500, height: 750, vote_average: 10, iso_639_1: 'fr' },
        { file_path: '/good-en.jpg', width: 500, height: 750, vote_average: 8, iso_639_1: 'en' }
      ],
      backdrops: [{ file_path: '/bd.jpg', width: 1280, height: 720, vote_average: 7, iso_639_1: null }]
    }
  };

  it('maps the core fields and trims the tagline', async () => {
    const { fetch: f } = stub([details]);
    const d = await new TmdbProvider('k', f).fetchDetails(157336);

    assert.equal(d.title, 'Interstellar');
    assert.equal(d.year, 2014);
    assert.equal(d.runtimeMin, 169);
    assert.equal(d.tagline, 'Mankind was born on Earth.');
    assert.deepEqual(d.genres, ['Adventure', 'Drama']);
    assert.equal(d.rating, 8.4);
  });

  it('requests credits and images in a single call', async () => {
    const { fetch: f, calls } = stub([details]);
    await new TmdbProvider('k', f).fetchDetails(157336);

    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.url.includes('append_to_response=credits%2Cimages'));
  });

  it('keeps key crew jobs and drops the rest', async () => {
    const { fetch: f } = stub([details]);
    const d = await new TmdbProvider('k', f).fetchDetails(157336);

    const jobs = d.crew.map((c) => c.job);
    assert.ok(jobs.includes('Director'));
    assert.ok(jobs.includes('Original Music Composer'));
    assert.ok(!jobs.includes('Best Boy Grip'));
  });

  it('ranks posters English-first so the title art is kept', async () => {
    const { fetch: f } = stub([details]);
    const d = await new TmdbProvider('k', f).fetchDetails(157336);

    assert.equal(d.posters[0]?.path, '/good-en.jpg', 'highest-voted English poster first');
    assert.equal(d.posters[1]?.path, '/low.jpg', 'lower-voted English still beats textless');
    assert.equal(d.posters[2]?.path, '/best.jpg', 'textless is the fallback');
    assert.equal(d.posters[3]?.path, '/fr.jpg', 'foreign-language last despite top vote');
  });

  it('ranks backdrops by vote without penalising textless plates', async () => {
    const { fetch: f } = stub([
      {
        ...details,
        images: {
          posters: [],
          backdrops: [
            { file_path: '/bd-en.jpg', width: 1280, height: 720, vote_average: 4, iso_639_1: 'en' },
            { file_path: '/bd-clean.jpg', width: 1280, height: 720, vote_average: 9, iso_639_1: null }
          ]
        }
      }
    ]);
    const d = await new TmdbProvider('k', f).fetchDetails(157336);
    assert.equal(d.backdrops[0]?.path, '/bd-clean.jpg');
  });

  it('survives a response with no credits or images', async () => {
    const { fetch: f } = stub([{ id: 1, title: 'Bare' }]);
    const d = await new TmdbProvider('k', f).fetchDetails(1);

    assert.deepEqual(d.cast, []);
    assert.deepEqual(d.posters, []);
    assert.equal(d.overview, '');
    assert.equal(d.year, null);
  });
});

describe('TmdbProvider errors', () => {
  it('treats a 401 as fatal, not retryable', async () => {
    const { fetch: f } = stub([{ status_message: 'Invalid API key' }], 401);
    await assert.rejects(
      () => new TmdbProvider('bad', f).search('Heat', null),
      (err: unknown) => err instanceof ProviderError && err.status === 401 && !err.retryable
    );
  });

  it('treats a 429 as retryable', async () => {
    const { fetch: f } = stub([{}], 429);
    await assert.rejects(
      () => new TmdbProvider('k', f).search('Heat', null),
      (err: unknown) => err instanceof ProviderError && err.retryable
    );
  });

  it('treats a network failure as retryable', async () => {
    const failing = (async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => new TmdbProvider('k', failing).search('Heat', null),
      (err: unknown) => err instanceof ProviderError && err.retryable && err.status === null
    );
  });
});

describe('TmdbProvider.imageUrl', () => {
  it('uses different sizes for posters and backdrops', () => {
    const p = new TmdbProvider('k');
    assert.equal(p.imageUrl('/x.jpg', 'poster'), 'https://image.tmdb.org/t/p/w500/x.jpg');
    assert.equal(p.imageUrl('/x.jpg', 'backdrop'), 'https://image.tmdb.org/t/p/w1280/x.jpg');
  });
});
