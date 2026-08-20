import type { ParsedName, ReleaseTags } from '@shared/types';

/**
 * Parses release-style names like
 *   "Oppenheimer (2023) [1080p] [BluRay] [x265] [10bit] [5.1] [YTS.MX]"
 *   "Interstellar.2014.1080p.BluRay.x264.YIFY.mp4"
 * into a title, a year, and the release tags that were stripped off.
 *
 * The tags are kept rather than discarded so the UI can show quality badges
 * and so a bad parse is debuggable without re-reading the disk.
 */

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mkv',
  'avi',
  'm4v',
  'mov',
  'wmv',
  'flv',
  'webm',
  'mpg',
  'mpeg',
  'ts',
  'm2ts'
]);

const SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt']);

/** Earliest plausible release year; anything below is a false positive. */
const MIN_YEAR = 1880;
/** Allow a few years ahead for pre-release folders (e.g. Project Hail Mary 2026). */
const FUTURE_YEAR_SLACK = 5;

const RESOLUTION = /^(?:480|540|576|720|1080|1440|2160|4320)[pi]$|^(?:4k|8k|uhd)$/i;
const CODEC = /^(?:x\.?26[45]|h\.?26[45]|hevc|avc|xvid|divx|av1|vp9|mpeg-?[24])$/i;
const BIT_DEPTH = /^(?:8|10|12)-?bits?$/i;
const AUDIO =
  /^(?:aac(?:\d(?:\.\d)?)?|ac-?3|e-?ac-?3|dts(?:-hd)?(?:-ma)?|dd\+?[57]?(?:\.1)?|ddp[57]?(?:\.1)?|truehd|atmos|flac|opus|[157]\.[01]|2\.0)$/i;
/** Release groups. YTS rotates TLDs constantly, hence the loose suffix. */
const GROUP = /^(?:yts(?:\.[a-z]{2,3})?|yify|rarbg|sparks|evo|fgt|ntb|geckos|amiable|drones|blow|cmrg|edith|galaxyrg|megusta|psa|tigole|qxr|anoxmous|maxspeed|publichd)$/i;

/** Source words that cannot plausibly appear in a real title. */
const SOURCE_STRONG =
  /^(?:blu-?ray|bd-?rip|br-?rip|dvd-?rip|web-?rip|web-?dl|webdl|hd-?rip|hdtv|pdtv|sdtv|remux|telesync|screener)$/i;
/** Source words that CAN appear in a title ("Cam", "Web", "The Dvd"). */
const SOURCE_WEAK = /^(?:web|dvd|cam|ts|tc|r5|scr)$/i;

/**
 * Flags are weak on purpose: "Uncut Gems", "The Complete Unknown" and
 * "Limited Partners" are all real titles. Inside brackets they are always
 * treated as tags; in bare text they only count once the title has ended.
 */
const FLAG =
  /^(?:repack|proper|re-?rip|remastered|restored|extended|unrated|uncut|uncensored|theatrical|imax|hybrid|limited|internal|complete|dubbed|subbed|multi|dual|hdr|hdr10\+?|dv|dolby-?vision|sdr|open-?matte|3d|half-?sbs|sbs)$/i;

/** Fragments of a scene URL. Also weak — "to", "am" and "re" are English words. */
const NOISE = /^(?:www|com|net|org|mx|lt|ag|am|bz|gg|re|to)$/i;

type TokenKind = keyof Omit<ReleaseTags, 'flags'> | 'flag' | 'noise';

/**
 * Strong tokens may terminate a title; weak ones may not. Without this split,
 * "Uncut Gems" parses to an empty title and "A Walk to Remember" loses
 * everything after "Walk".
 */
type TokenStrength = 'strong' | 'weak';

interface TokenInfo {
  kind: TokenKind;
  strength: TokenStrength;
}

function classify(token: string): TokenInfo | null {
  if (RESOLUTION.test(token)) return { kind: 'resolution', strength: 'strong' };
  if (CODEC.test(token)) return { kind: 'codec', strength: 'strong' };
  if (BIT_DEPTH.test(token)) return { kind: 'bitDepth', strength: 'strong' };
  if (AUDIO.test(token)) return { kind: 'audio', strength: 'strong' };
  if (GROUP.test(token)) return { kind: 'group', strength: 'strong' };
  if (SOURCE_STRONG.test(token)) return { kind: 'source', strength: 'strong' };
  if (SOURCE_WEAK.test(token)) return { kind: 'source', strength: 'weak' };
  if (FLAG.test(token)) return { kind: 'flag', strength: 'weak' };
  if (NOISE.test(token)) return { kind: 'noise', strength: 'weak' };
  return null;
}

function emptyTags(): ReleaseTags {
  return {
    resolution: null,
    source: null,
    codec: null,
    bitDepth: null,
    audio: null,
    group: null,
    flags: []
  };
}

function isYear(token: string): number | null {
  if (!/^\d{4}$/.test(token)) return null;
  const n = Number(token);
  const max = new Date().getFullYear() + FUTURE_YEAR_SLACK;
  return n >= MIN_YEAR && n <= max ? n : null;
}

/**
 * Release names use dots as separators ("A.Movie.2014.1080p") but real titles
 * also contain dots ("Guardians Of The Galaxy Vol. 2"). Only treat dots as
 * separators when the name has no spaces at all.
 */
export function normalizeSeparators(input: string): string {
  const hasSpaces = /\s/.test(input);
  let s = input;
  if (!hasSpaces) s = s.replace(/[._]+/g, ' ');
  else s = s.replace(/_+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function stripVideoExtension(input: string): string {
  const m = /\.([a-z0-9]{2,4})$/i.exec(input);
  if (m && m[1] && VIDEO_EXTENSIONS.has(m[1].toLowerCase())) {
    return input.slice(0, m.index);
  }
  return input;
}

function applyToken(tags: ReleaseTags, kind: TokenKind, token: string): void {
  switch (kind) {
    case 'resolution':
      tags.resolution ??= token;
      break;
    case 'source':
      tags.source ??= token;
      break;
    case 'codec':
      tags.codec ??= token;
      break;
    case 'bitDepth':
      tags.bitDepth ??= token;
      break;
    case 'audio':
      tags.audio ??= token;
      break;
    case 'group':
      tags.group ??= token;
      break;
    case 'flag':
      if (!tags.flags.some((f) => f.toLowerCase() === token.toLowerCase())) {
        tags.flags.push(token);
      }
      break;
    default:
      break;
  }
}

/**
 * Consumes every `[...]` and `(...)` group, recording years and release tags.
 * Returns the name with those groups blanked out so the remainder can be
 * tokenized for the title.
 */
function extractGroups(input: string, tags: ReleaseTags): { rest: string; year: number | null } {
  let year: number | null = null;
  const rest = input.replace(/[[(]([^\])]*)[\])]/g, (_whole, inner: string) => {
    const trimmed = inner.trim();

    const asYear = isYear(trimmed);
    if (asYear !== null) {
      // Parenthesised years win over bare ones; first occurrence wins.
      year ??= asYear;
      return ' ';
    }

    // A bracket may hold several tags: "[YTS.GG - YTS.BZ]", "[BluRay 5.1]".
    const parts = trimmed.split(/[\s\-–—]+/).filter(Boolean);
    let recognized = 0;
    for (const part of parts) {
      const info = classify(part);
      if (info) {
        applyToken(tags, info.kind, part);
        recognized += 1;
      }
    }

    // Unrecognized bracket content that isn't a tag (rare) is dropped from the
    // title anyway — brackets are never part of a real movie title here.
    if (recognized === 0 && parts.length > 0) {
      tags.flags.push(trimmed);
    }
    return ' ';
  });

  return { rest, year };
}

export function parseReleaseName(raw: string): ParsedName {
  const tags = emptyTags();
  const base = normalizeSeparators(stripVideoExtension(raw));

  const { rest, year: bracketYear } = extractGroups(base, tags);

  const tokens = rest.split(/\s+/).filter(Boolean);

  // Walk left to right. The title ends at the first *strong* release token or,
  // when no bracketed year was found, at the first bare year that isn't the
  // very first token — "2012 (2009)" must keep 2012 as the title.
  const titleTokens: string[] = [];
  let bareYear: number | null = null;
  let titleClosed = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const info = classify(token);
    const asYear = isYear(token);

    if (!titleClosed) {
      if (asYear !== null && i > 0) {
        bareYear ??= asYear;
        titleClosed = true;
        continue;
      }
      if (info && info.strength === 'strong') {
        applyToken(tags, info.kind, token);
        titleClosed = true;
        continue;
      }
      // Weak tokens are kept — they are probably part of the title.
      titleTokens.push(token);
      continue;
    }

    // Past the cut, anything recognizable is a tag.
    if (asYear !== null) {
      bareYear ??= asYear;
      continue;
    }
    if (info) applyToken(tags, info.kind, token);
  }

  // A weak token trailing the title ("Some Movie EXTENDED 1080p") is a tag
  // after all. Never trim down to nothing.
  while (titleTokens.length > 1) {
    const last = titleTokens[titleTokens.length - 1]!;
    const info = classify(last);
    if (!info || info.strength !== 'weak') break;
    applyToken(tags, info.kind, last);
    titleTokens.pop();
  }

  const title = cleanTitle(titleTokens.join(' ')) || cleanTitle(base) || raw;

  return {
    title,
    searchTitle: toSearchTitle(title),
    year: bracketYear ?? bareYear,
    tags,
    raw
  };
}

function cleanTitle(input: string): string {
  return input
    .replace(/[\s\-–—._]+$/, '')
    .replace(/^[\s\-–—._]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nudges a title toward what a metadata provider expects. Release folders
 * substitute " - " for colons ("Captain America - The First Avenger"), which
 * hurts exact-title matching.
 */
export function toSearchTitle(title: string): string {
  return title
    .replace(/\s+[-–—]\s+/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isVideoFile(filename: string): boolean {
  const ext = extensionOf(filename);
  return ext !== null && VIDEO_EXTENSIONS.has(ext);
}

export function isSubtitleFile(filename: string): boolean {
  const ext = extensionOf(filename);
  return ext !== null && SUBTITLE_EXTENSIONS.has(ext);
}

export function extensionOf(filename: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m && m[1] ? m[1].toLowerCase() : null;
}

/**
 * Best-effort language label from a subtitle filename, e.g. "...-English.srt".
 * Guards against dot-separated release names, where the trailing word is the
 * release group ("...x264.YIFY.srt") rather than a language.
 */
export function subtitleLabel(filename: string): string {
  const stem = filename.replace(/\.[a-z0-9]+$/i, '');
  const m = /[-._]([A-Za-z]{3,20})$/.exec(stem);
  const word = m?.[1];
  if (!word || classify(word)) return 'Default';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
