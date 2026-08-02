/**
 * SubRip → WebVTT conversion.
 *
 * The library ships `.srt` files, which `<track>` will not load — browsers
 * accept WebVTT only. The differences are small but every one of them is fatal
 * if missed: the WEBVTT header, `.` instead of `,` in timestamps, and hours
 * being mandatory.
 *
 * Pure, so the awkward real-world cases can be tested without touching disk.
 */

/** Matches an SRT cue timing line, tolerating missing hours and either separator. */
const TIMING =
  /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})(.*)$/;

function pad(value: string, width: number): string {
  return value.padStart(width, '0');
}

function toVttTimestamp(
  hours: string | undefined,
  minutes: string,
  seconds: string,
  millis: string
): string {
  // WebVTT allows mm:ss.mmm, but hh:mm:ss.mmm is accepted everywhere and
  // avoids ambiguity when a cue crosses the hour.
  return `${pad(hours ?? '0', 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${millis.padEnd(3, '0').slice(0, 3)}`;
}

/**
 * True when a line is just a cue number — SRT numbers its cues, WebVTT treats
 * a bare number before a timing line as a cue identifier. Harmless either way,
 * but dropping them keeps the output clean.
 */
function isCueNumber(line: string, next: string | undefined): boolean {
  return /^\d+$/.test(line.trim()) && next !== undefined && TIMING.test(next);
}

export function srtToVtt(input: string): string {
  const text = input
    // A UTF-8 BOM before WEBVTT makes the whole file fail to parse.
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');

  const lines = text.split('\n');
  const out: string[] = ['WEBVTT', ''];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    if (isCueNumber(line, lines[i + 1])) continue;

    const timing = TIMING.exec(line);
    if (timing) {
      const [, h1, m1, s1, ms1, h2, m2, s2, ms2, trailing] = timing;
      const from = toVttTimestamp(h1, m1!, s1!, ms1!);
      const to = toVttTimestamp(h2, m2!, s2!, ms2!);
      // Positioning cues (`X1:… Y1:…`) are SRT-specific and not valid VTT.
      const settings = (trailing ?? '').trim().startsWith('X1:') ? '' : (trailing ?? '').trim();
      out.push(settings ? `${from} --> ${to} ${settings}` : `${from} --> ${to}`);
      continue;
    }

    out.push(line);
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Cheap check so an already-converted file is not double-processed. */
export function isVtt(input: string): boolean {
  return input.replace(/^﻿/, '').trimStart().startsWith('WEBVTT');
}
