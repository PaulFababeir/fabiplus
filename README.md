# Fabi+

An offline desktop library and player for a local collection of films and shows.
Point it at a folder and it scans it, pulls artwork and metadata from TMDB, and
plays it back — with per-profile watch progress, resume, subtitles, and optional
Discord Rich Presence.

No account, no cloud, no telemetry. The only network call is TMDB metadata
enrichment, and everything it returns is cached to disk, so the app works with
the network off.

> Windows only for now. Nothing in the code is Windows-specific except the
> installer and the Discord named-pipe path, but it has not been tried elsewhere.

## Installing

**Windows 10/11, 64-bit.** One file, from
[Releases](https://github.com/PaulFababeir/movie-app/releases):

```
movie-app-<version>-setup.exe
```

That is the whole app — Electron, the fonts and every dependency are bundled, so
there is nothing else to install. No Node, no npm, no cloning the source.

Ignore the other two files on a release. `latest.yml` and the `.blockmap` are
what the in-app updater reads; downloading them by hand does nothing.

It installs per-user, so there is no UAC prompt. The build is unsigned, so
SmartScreen will warn the first time — **More info → Run anyway**. Updates are
manual, from Settings; nothing phones home on its own.

### What you supply

The app ships no films and no API key of its own:

- **Your films**, in a folder you point it at on first run.
- **A free [TMDB API key](https://www.themoviedb.org/settings/api)** for posters
  and metadata. Optional — without one the library still scans and plays, it
  just shows titles parsed from the folder names instead of artwork.

Discord Rich Presence needs nothing at all: one toggle in Settings, off by
default.

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

   Shows have their own list in the same panel — one subfolder per show, with a
   folder per season inside it. Episode numbers are read from the filenames, and
   a folder that is not a numbered season (an "Unaired Pilot", say) is kept and
   shown as it is rather than dropped.

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
| `profiles/<id>.json` | Watch progress, poster and backdrop picks | **No** |
| `config.json` | Folders, TMDB key, preferences | Yes |
| `cache/images/` | Posters, backdrops, episode stills | Yes |
| `cache/avatars/` | Profile pictures you chose | **No** |

The split is deliberate: a corrupt catalog or a full rescan can never touch your
watch history. Every write goes to a temp file and is renamed into place.

Your films are never moved, renamed, or modified. The app only reads them.

The one thing it writes into your library is a subtitle you asked it to
download: the `.srt` lands next to the video it belongs to, named after it, so
it works in any other player too. Nothing else is ever written there, and
nothing is downloaded unless you press the button.

## Discord Rich Presence

Off by default. Flip the toggle in Settings — there is nothing to register or
paste in.

While a film is playing your profile reads *Watching &lt;title&gt;* with the
poster and a countdown; paused and browsing states are shown too. It talks to
the local Discord client over its named pipe and never contacts Discord's
servers. If Discord is not running, presence simply stays off.

## Building from source

```bash
npm install
npm run dev        # electron-vite dev, hot reload on the renderer
npm test           # 185 tests, node:test via tsx
npm run typecheck  # tsc --build
npm run dist       # NSIS installer into release/
```

Requires Node 20+. Only one instance runs at a time — launching a second focuses
the first, which can look like nothing happened.

### Cutting a release

```bash
npm version patch        # bumps package.json, commits, creates the tag
git push --follow-tags
```

That tag triggers `.github/workflows/release.yml`, which builds on Windows and
uploads the installer and update feed to a **draft** release. Publish the draft
on GitHub to make it downloadable and visible to the in-app updater.

## Known gaps

- **AC-3, E-AC-3, DTS and TrueHD audio must be converted before it plays.** It
  happens automatically on first play with the video stream copied untouched —
  about ten seconds for a 700 MB file, then cached. Bundling mpv would remove
  the step. The Matroska container and HEVC video both play natively.
- **The grid is not virtualized.** Fine at a few hundred films, not at thousands.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.
Metadata and artwork come from [TMDB](https://www.themoviedb.org/).

Bundles [Poppins](https://fonts.google.com/specimen/Poppins) under the SIL Open
Font License.

## License

[MIT](LICENSE)
