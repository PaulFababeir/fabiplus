/**
 * Parsing of ffmpeg's stream table.
 *
 * Apart from `embedded-subs.ts` because that module reaches `config.ts` for the
 * cache location, which imports `electron` — nothing importing it can be loaded
 * by a test. This half is pure string work and decides which tracks get
 * extracted and what they are called, so it needs to be testable.
 */

/** ISO 639-2 codes ffmpeg reports, mapped to something readable. */
export const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  spa: 'Spanish',
  fre: 'French',
  fra: 'French',
  ger: 'German',
  deu: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  dut: 'Dutch',
  nld: 'Dutch',
  rus: 'Russian',
  jpn: 'Japanese',
  kor: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  ara: 'Arabic',
  hin: 'Hindi',
  gre: 'Greek',
  ell: 'Greek',
  hun: 'Hungarian',
  pol: 'Polish',
  rum: 'Romanian',
  ron: 'Romanian',
  tur: 'Turkish',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  cze: 'Czech',
  ces: 'Czech',
  heb: 'Hebrew',
  tha: 'Thai',
  vie: 'Vietnamese',
  ind: 'Indonesian',
  tgl: 'Tagalog',
  fil: 'Filipino'
};

export interface SubtitleStream {
  /** Stream index within the container, for `-map 0:N`. */
  index: number;
  /** Filename-safe display label. */
  label: string;
}

/**
 * Reads subtitle streams out of ffmpeg's `-i` output.
 *
 * Image-based formats are skipped: PGS and VobSub are bitmaps, and there is no
 * honest conversion to WebVTT — extracting them would produce empty files that
 * look like broken subtitles rather than absent ones.
 */
export function parseSubtitleStreams(ffmpegOutput: string): SubtitleStream[] {
  const streams: SubtitleStream[] = [];
  const seen = new Map<string, number>();

  for (const line of ffmpegOutput.split('\n')) {
    const match = /Stream #\d+:(\d+)(?:\(([a-z]{2,3})\))?[^:]*:\s*Subtitle:\s*(\w+)/i.exec(line);
    if (!match?.[1] || !match[3]) continue;

    const codec = match[3].toLowerCase();
    if (codec === 'hdmv_pgs_subtitle' || codec === 'dvd_subtitle' || codec === 'pgssub') continue;

    const code = match[2]?.toLowerCase() ?? '';
    const base = LANGUAGE_NAMES[code] ?? (code === '' ? 'Subtitles' : code.toUpperCase());

    // Two English tracks are common (dialogue and full/SDH); number the repeats
    // so the menu does not show the same word twice with no way to tell them apart.
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);

    streams.push({
      index: Number(match[1]),
      label: count === 1 ? base : `${base} ${count}`
    });
  }

  return streams;
}
