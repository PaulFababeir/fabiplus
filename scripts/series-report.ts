import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseEpisodeName, parseSeasonFolder, parseSeriesFolder } from '../src/main/services/episode-parser.js';

const ROOT = process.argv[2] ?? 'D:/Series';

const shows = await readdir(ROOT, { withFileTypes: true });
for (const show of shows.filter((d) => d.isDirectory())) {
  const meta = parseSeriesFolder(show.name);
  console.log(`\n${show.name}\n  -> title=${JSON.stringify(meta.title)} year=${meta.year}`);

  const seasons = await readdir(join(ROOT, show.name), { withFileTypes: true });
  for (const dir of seasons.filter((d) => d.isDirectory())) {
    const season = parseSeasonFolder(dir.name);
    const files = (await readdir(join(ROOT, show.name, dir.name))).filter((f) => /\.(mkv|mp4|avi)$/i.test(f));
    console.log(`  [${dir.name}] -> n=${season.number} label=${JSON.stringify(season.label)} (${files.length} files)`);
    for (const f of files) {
      const ep = parseEpisodeName(f);
      const s = ep.season ?? season.number;
      console.log(`      S${String(s ?? '?').padStart(2, '0')}E${String(ep.episode ?? '?').padStart(2, '0')}  ${JSON.stringify(ep.title)}`);
    }
  }
}
