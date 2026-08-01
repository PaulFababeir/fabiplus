/**
 * Dev tool: scans a library root and prints what the parser made of every
 * folder, so bad parses can be spotted before any network calls happen.
 *
 *   npm run scan:report -- "D:/Movies"
 */
import { writeFile } from 'node:fs/promises';

import { scanRoot } from '../src/main/services/scanner.js';
import type { LibraryItem } from '../src/shared/types.js';

const root = process.argv[2] ?? 'D:/Movies';
const jsonOut = process.argv[3] ?? null;

function pad(s: string, width: number): string {
  const clean = s.length > width ? `${s.slice(0, width - 1)}…` : s;
  return clean.padEnd(width);
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function tagSummary(item: LibraryItem): string {
  const t = item.parsed.tags;
  return [t.resolution, t.source, t.codec, t.bitDepth, t.group]
    .filter(Boolean)
    .join(' ')
    .trim();
}

const main = async (): Promise<void> => {
  console.log(`\nScanning ${root} …\n`);
  const { items, issues, durationMs } = await scanRoot(root, 'movie');

  console.log(
    `${pad('#', 4)}${pad('PARSED TITLE', 38)}${pad('YEAR', 6)}${pad('TAGS', 26)}${pad('SIZE', 10)}EXT`
  );
  console.log('-'.repeat(96));

  items.forEach((item, i) => {
    console.log(
      pad(String(i + 1), 4) +
        pad(item.parsed.title, 38) +
        pad(item.parsed.year === null ? '—' : String(item.parsed.year), 6) +
        pad(tagSummary(item), 26) +
        pad(gb(item.video.size), 10) +
        item.video.ext
    );
  });

  console.log('-'.repeat(96));
  console.log(`${items.length} titles, ${(items.reduce((n, i) => n + i.video.size, 0) / 1e9).toFixed(1)} GB, scanned in ${durationMs} ms`);

  const noYear = items.filter((i) => i.parsed.year === null);
  const withSubs = items.filter((i) => i.subtitles.length > 0);
  console.log(`${withSubs.length} titles have subtitles, ${noYear.length} have no year`);

  if (issues.length > 0) {
    console.log('\nISSUES');
    for (const issue of issues) {
      console.log(`  [${issue.reason}] ${issue.detail}`);
    }
  }

  console.log('\nRAW FOLDER → PARSED (full list)');
  for (const item of items) {
    console.log(`  ${item.folderName}`);
    console.log(
      `      → title="${item.parsed.title}" search="${item.parsed.searchTitle}" year=${item.parsed.year ?? 'null'} subs=${item.subtitles.length}`
    );
  }

  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify({ items, issues }, null, 2), 'utf8');
    console.log(`\nWrote ${jsonOut}`);
  }
};

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
