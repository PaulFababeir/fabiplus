import { scanRoot } from '../src/main/services/scanner.js';

/** Prints the season/episode tree the scanner builds, no network. */
const root = process.argv[2] ?? 'D:/Series';
const result = await scanRoot(root, 'series');

for (const show of result.items) {
  console.log(`\n${show.parsed.title}${show.parsed.year ? ` (${show.parsed.year})` : ''}`);
  console.log(`  id=${show.id}  folder=${show.folderName}`);
  for (const season of show.seasons ?? []) {
    console.log(`  ${season.label}  [n=${season.number}]  ${season.episodes.length} episodes`);
    for (const ep of season.episodes) {
      const n = ep.number === null ? '??' : String(ep.number).padStart(2, '0');
      const gb = (ep.video.size / 1e9).toFixed(2);
      console.log(`      E${n}  ${ep.title ?? '(untitled)'}  — ${gb} GB, ${ep.subtitles.length} subs`);
    }
  }
}
for (const issue of result.issues) console.log(`ISSUE ${issue.reason}: ${issue.detail}`);
console.log(`\n${result.items.length} show(s) in ${result.durationMs}ms`);
