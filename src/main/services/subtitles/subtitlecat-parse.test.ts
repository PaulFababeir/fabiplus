import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseSearchResults,
  parseSubtitleOptions,
  subtitleFileName
} from './subtitlecat-parse.js';

/**
 * Markup reduced from a real page — `subtitlecat.com/subs/1244/Interstellar…`
 * — keeping the parts the parser reads and nothing else. Scraping breaks
 * silently when a site is redesigned, so the shape lives here rather than in
 * someone's memory.
 */
const DETAIL = `
<div class="col-md-6 col-lg-4"><div class="sub-single">
  <span><img src="/assets/flags/gb.png" alt="en" class="flag"></span>
  <span>English</span>
  <span><a id="download_en" onclick="log_download(1);" href="/subs/1431/Interstellar-en.srt" class="green-link">Download</a></span>
</div></div>
<div class="col-md-6 col-lg-4"><div class="sub-single">
  <span><img src="/assets/flags/br.png" alt="pt-BR" class="flag"></span>
  <span>Portuguese (Brazil)</span>
  <span><a id="download_pt-BR" href="/subs/1320/Interstellar-pt-BR.srt" class="green-link">Download</a></span>
</div></div>
<div class="col-md-6 col-lg-4"><div class="sub-single">
  <span><img src="/assets/flags/cz.png" alt="cs" class="flag"></span>
  <span>Czech</span>
  <span><a id="translate_cs" href="javascript:void(0)" class="yellow-link">Translate</a></span>
</div></div>
`;

describe('parseSubtitleOptions', () => {
  /** The whole point: only what can actually be downloaded is offered. */
  it('skips a language the site would have to machine-translate', () => {
    assert.deepEqual(
      parseSubtitleOptions(DETAIL).map((o) => o.code),
      ['en', 'pt-BR']
    );
  });

  it('reads the code, the name and the file path', () => {
    const [first] = parseSubtitleOptions(DETAIL);
    assert.deepEqual(first, {
      code: 'en',
      language: 'English',
      path: 'subs/1431/Interstellar-en.srt'
    });
  });

  /** The flag lives in its own span; only a text-only span is the name. */
  it('does not mistake the flag markup for the language name', () => {
    for (const option of parseSubtitleOptions(DETAIL)) {
      assert.ok(!option.language.includes('<'), option.language);
      assert.ok(!option.language.includes('img'), option.language);
    }
  });

  it('handles a regional code', () => {
    const brazil = parseSubtitleOptions(DETAIL).find((o) => o.code === 'pt-BR');
    assert.equal(brazil?.language, 'Portuguese (Brazil)');
  });

  it('survives a page with nothing downloadable', () => {
    assert.deepEqual(parseSubtitleOptions('<div class="sub-single">nothing</div>'), []);
    assert.deepEqual(parseSubtitleOptions(''), []);
  });
});

describe('parseSearchResults', () => {
  const SEARCH = `
    <table>
      <tr><td><a href="subs/1244/Interstellar.2014.1080p.BluRay.x264.YIFY.html">Interstellar.2014.1080p.BluRay.x264.YIFY</a></td><td>12 languages</td></tr>
      <tr><td><a href="subs/55/La%20Ciencia%20de%20Interstellar.html">La Ciencia de Interstellar</a></td><td>16 languages</td></tr>
      <tr><td><a href="subs/1244/Interstellar.2014.1080p.BluRay.x264.YIFY.html">duplicate</a></td></tr>
    </table>`;

  it('reads the release name, which is what timing follows', () => {
    const hits = parseSearchResults(SEARCH);
    assert.equal(hits[0]?.path, 'subs/1244/Interstellar.2014.1080p.BluRay.x264.YIFY.html');
    assert.equal(hits[0]?.title, 'Interstellar.2014.1080p.BluRay.x264.YIFY');
  });

  it('keeps every distinct release', () => {
    assert.equal(parseSearchResults(SEARCH).length, 2);
  });

  it('survives a search that found nothing', () => {
    assert.deepEqual(parseSearchResults('<table></table>'), []);
  });
});

describe('subtitleFileName', () => {
  /**
   * Named so the existing scanner picks it up unaided: `shareStem` matches on
   * the video's stem, and `subtitleLabel` reads the trailing word as the label.
   */
  it('leads with the video stem and ends with the language', () => {
    assert.equal(
      subtitleFileName('Interstellar.2014.1080p.BluRay.x264.YIFY.mp4', 'English'),
      'Interstellar.2014.1080p.BluRay.x264.YIFY.English.srt'
    );
  });

  it('keeps a regional name readable', () => {
    assert.equal(
      subtitleFileName('Film.mkv', 'Portuguese (Brazil)'),
      'Film.Portuguese (Brazil).srt'
    );
  });

  /** The language comes off a scraped page, so it cannot be trusted as a path. */
  it('strips anything that could escape the folder', () => {
    assert.equal(subtitleFileName('Film.mkv', '../../evil'), 'Film.evil.srt');
    assert.equal(subtitleFileName('Film.mkv', 'a/b\\c'), 'Film.abc.srt');
    assert.equal(subtitleFileName('Film.mkv', '???'), 'Film.Downloaded.srt');
  });
});
