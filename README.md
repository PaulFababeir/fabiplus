# Movie Library

An offline desktop movie library and player for a local collection. Point it at
a folder of films and it scans them, pulls artwork and metadata from TMDB, and
plays them back — with per-profile watch progress, resume, subtitles, and
optional Discord Rich Presence.

No account, no cloud, no telemetry. The only network call is TMDB metadata
enrichment, and everything it returns is cached to disk, so the app works with
the network off.

> Windows only for now. Nothing in the code is Windows-specific except the
> installer and the Discord named-pipe path, but it has not been tried elsewhere.

## Installing

Grab the installer from [Releases](https://github.com/PaulFababeir/movie-app/releases)
and run it. It installs per-user, so there is no UAC prompt.

The build is unsigned, so SmartScreen will warn the first time — **More info →
Run anyway**. Updates are manual, from Settings; nothing phones home on its own.

## First run

1. **Settings → Movie folders → Add folder…** and choose the folder holding your
   films. Each film should be in its own subfolder:

   ```
   D:/Movies/
     Interstellar (2014) [1080p] [BluRay] [YTS.MX]/
       Interstellar.2014.1080p.BluRay.x264.mp4
       Interstellar.srt
     Solanin (2010) [1080p]/
       ...
   ```

   Release-tagged folder names are parsed for the title and year, so most
   collections work as-is. Films are scanned as soon as a folder is added.

2. **Settings → TMDB API key.** Metadata and artwork need a free key from
   [themoviedb.org](https://www.themoviedb.org/settings/api) — either a v3 API
   key or a v4 read token. Without one the library still scans and plays; it
   just shows parsed filenames instead of posters.

3. **Settings → Fetch metadata.** Matching is fuzzy and weighted by year. Any
   film it is unsure about is listed for you to confirm, and you can re-match a
   title by hand at any time.

## Where your data lives

`%APPDATA%/movie-app/`

| File | Contents | Regenerable? |
|---|---|---|
| `library.json` | Catalog and scraped metadata | Yes — rescan and refetch |
| `library.backup.json` | Snapshot taken after each enrichment | — |
| `profiles.json` | Profile list (max 5) | **No** |
| `profiles/<id>.json` | Watch progress, poster picks | **No** |
| `config.json` | Folders, TMDB key, preferences | Yes |
| `cache/images/` | Posters and backdrops | Yes |

The split is deliberate: a corrupt catalog or a full rescan can never touch your
watch history. Every write goes to a temp file and is renamed into place.

Your films are never moved, renamed, or written to. The app only reads them.

## Discord Rich Presence

Off by default. To enable it, create an application at
[discord.com/developers](https://discord.com/developers/applications) — the name
you give it there is what Discord displays — and paste its Application ID into
Settings. No other portal setup is needed.

While a film is playing your profile reads *Watching &lt;title&gt;* with the
poster and a countdown; paused and browsing states are shown too. It talks to
the local Discord client over its named pipe and never contacts Discord's
servers. If Discord is not running, presence simply stays off.

## Building from source

```bash
npm install
npm run dev        # electron-vite dev, hot reload on the renderer
npm test           # 175 tests, node:test via tsx
npm run typecheck  # tsc --build
npm run dist       # NSIS installer into release/
```

Requires Node 20+. Only one instance runs at a time — launching a second focuses
the first, which can look like nothing happened.

## Known gaps

- **`.mkv` and 10-bit HEVC do not play.** Chromium cannot decode them; the
  player shows a clear error naming the format. Bundling mpv is the real fix.
- **Series is unwired.** The Movies/Series toggle is UI only — the scanner has
  no season/episode model yet.
- **The grid is not virtualized.** Fine at a few hundred films, not at thousands.
- **Profile rename** exists in the store and IPC but has no UI.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.
Metadata and artwork come from [TMDB](https://www.themoviedb.org/).

Bundles [Poppins](https://fonts.google.com/specimen/Poppins) under the SIL Open
Font License.

## License

[MIT](LICENSE)
