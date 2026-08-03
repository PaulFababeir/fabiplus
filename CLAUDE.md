# movie-app

Offline desktop movie library and player for a local collection at `D:/Movies`
(79 films, ~172 GB). Electron + React + TypeScript. No cloud, no account, no
telemetry — the only network call is TMDB metadata enrichment, and everything it
returns is cached to disk so the app runs with the network off.

## Commands

```bash
npm run dev          # electron-vite dev, HMR on the renderer
npm start            # run the production build
npm run build        # tsc --noEmit && electron-vite build
npm test             # 136 tests, node:test via tsx
npm run typecheck
npm run scan:report  # print the parse table for every folder, no network
npm run dist         # NSIS installer into release/ (~97 MB)
npm run release      # same, published to GitHub Releases
```

Only one instance can run at a time (`requestSingleInstanceLock`). Launching a
second focuses the first — it will look like nothing happened. Editing anything
under `src/main/` or `src/preload/` restarts the app; renderer edits hot-reload.

## Layout

```
src/main/          Electron main. Scanner, TMDB provider, matcher, stores.
                   All 136 tests live here or in shared.
src/preload/       The entire renderer API surface (contextBridge).
src/renderer/      React UI. No Node access.
src/shared/        Types, constants, and pure logic both processes need.
scripts/           Dev tools.
```

`src/shared/constants.ts` exists because the renderer cannot import from main.
Anything both sides need goes there — several values were previously duplicated
by hand and drifted.

## Packaging and releases

`electron-builder`, NSIS, `perMachine: false` (installs per-user, no UAC).
Output is `release/movie-app-<version>-setup.exe` plus `latest.yml`, the feed
`electron-updater` polls.

**`build.productName` must stay `movie-app`.** Electron derives
`app.getPath('userData')` from `app.getName()`, which returns `productName` when
set. Changing it moves the data directory and orphans the catalog, profiles and
image cache in one release. The NSIS `shortcutName` carries the pretty name
instead — that is cosmetic and safe.

Updates are **manual only**, from Settings. Everything else works offline and a
background updater phoning home each launch would break that. Windows cannot
replace a running executable, so the installer downloads to temp and applies on
quit. Unsigned, so SmartScreen warns on first run.

### Versioning

`package.json` `version` drives the installer name, the update comparison and
`app.getVersion()`. SemVer, staying on `0.x` for now.

Separately — and this is the contract that actually matters — each stored file
carries its own `schemaVersion`, independent of the app version. A feature
release may not touch any schema; a patch release might bump one.

## Where the data lives

`%APPDATA%/movie-app/` (`C:\Users\<user>\AppData\Roaming\movie-app`)

| File | Contents | Regenerable? |
|---|---|---|
| `library.json` | Catalog + scraped metadata | Yes — rescan + refetch |
| `library.backup.json` | Snapshot after each enrichment | — |
| `profiles.json` | Profile list (max 5) | **No** |
| `profiles/<id>.json` | Watch progress, poster picks | **No** |
| `config.json` | Roots, TMDB key, prefs | Yes |
| `cache/images/` | Posters and backdrops | Yes |

The split is deliberate: a corrupt catalog or a full rescan must never be able
to touch watch history. Every write goes through `writeJsonAtomic` (temp file +
rename). Never write profile data in place.

## Decisions worth not relitigating

- **TMDB, not Letterboxd.** Letterboxd has no open API and sources its artwork
  from TMDB anyway. Sits behind a `MetadataProvider` interface if that changes.
- **Electron over Tauri.** WebView2 cannot decode the library's `.mkv` and
  10-bit HEVC files; a bundled player is needed either way, and Electron makes
  that far easier.
- **JSON, not SQLite.** 79 items. Swap `library.json` alone if it ever passes a
  few thousand.
- **CSS Modules, no framework.** The UI is built to a specific Figma; utility
  classes fight that, and things like intersected `mask-image` or
  `::-webkit-media-text-track-container` aren't expressible as utilities.
  Design values are CSS custom properties in `styles/tokens.css`.
- **Poppins is bundled** (`assets/fonts`, latin subset, 44 KB). It is not
  installed system-wide, and the CSP forbids remote stylesheets — naming it
  without bundling silently falls back to Segoe UI.

## Traps — each of these cost real time

**Filename parser.** Release tokens have strength tiers. Only unambiguous
markers (`1080p`, `x265`, `BluRay`, `YTS.*`, a year) may terminate a title.
Words that appear in real titles (`uncut`, `to`, `web`, `cam`) are weak and only
count once the title has ended. Without this, `Uncut Gems` parses to an empty
string and `A Walk to Remember` truncates to `A Walk`.

**TMDB artwork.** Do not send `include_image_language`. Restricting to `en,null`
starves non-English films — Solanin had exactly one usable poster because the
rest are tagged `ja`. Fetch every language, rank client-side in `rankImages`.
Posters rank English-first (title art reads better at thumbnail size);
backdrops prefer textless plates.

**`net.fetch(file://)` ignores Range headers.** Video seeking requires 206
partial responses, so `media-server.ts` parses Range and streams byte ranges by
hand. Do not "simplify" this back to `net.fetch`.

**`<track>` rejects SubRip.** `shared/subtitles.ts` converts. A UTF-8 BOM before
`WEBVTT` kills the entire file; hours are mandatory; SRT's `X1:` coordinates are
not valid VTT settings.

**Video darker than VLC.** Files can be mistagged as HDR10 (PQ/BT.2020) when
graded SDR — several YTS `HYBRID` releases are. Chromium honours the tag and
tone-maps; VLC does not. `video-colour.ts` reads the `colr` box and the player
applies an SVG gamma filter (`HDR_GAMMA`) to tagged files. CSS `filter` has no
gamma function, hence SVG. `force-color-profile=srgb` is set in main and handles
the separate display-ICC half of the problem.

**`readJsonSafe` vs `readJsonOrFail`.** Only a *missing* file may fall back to
empty. Treating an unreadable file as empty lets a caller conclude "nothing here
yet" and write fresh data over a good catalog. Read paths that write back must
use `readJsonOrFail`.

**Profile schema changes must migrate, never reset.** `profiles.ts` used to
return an empty state on any `schemaVersion` mismatch, which would have wiped
every user's watch history the first time the schema was bumped after a release.
`profile-migration.ts` now migrates forward through a `STEPS` registry and
*throws* on data newer than the build understands. Adding version 2 means adding
one entry to `STEPS` — do not edit the loader.

**React StrictMode double-invokes effects.** `ensureProfile` is serialised
behind a shared promise because two concurrent calls both saw an empty list,
both created a profile, and the second write orphaned the first — taking its
poster choices with it.

**`@shared/*` is a build-time alias.** Type-only imports are erased so they work
anywhere; **value** imports need runtime resolution, which is why `npm test`
passes `--tsconfig tsconfig.node.json`.

### CSS traps

- **`scrollbar-width` makes Chromium ignore every `::-webkit-scrollbar` rule**
  and fall back to a solid light bar. It is deliberately absent.
- **`scrollbar-gutter: stable`** on the sidebar. Without it the content box
  narrows by the scrollbar width when a tab overflows, and the poster —
  percentage-sized — visibly changes size between tabs.
- **Two-stop linear gradients show a band edge** where they terminate. The
  backdrop masks use 6–11 stops to approximate an ease-out falloff.
- **Layers that overlap must share one ramp.** `--backdrop-ramp` is consumed by
  both the artwork and its tint; when only the image carried it, the tint kept a
  hard left edge and drew a line down the join.
- **A flex child needs `min-height: 0` to scroll.** Without it the child refuses
  to shrink and pushes the dialog past `max-height`; combined with centring, the
  overflow goes both ways and the header lands off-screen.
- **`titleBarOverlay` paints an opaque strip.** The backdrop runs to `top: 0`
  but its mask *fades in*, so the strip behind the window buttons is bare page
  background and matches the painted colour.
- **motion owns `transform`.** Never also put a CSS `transition` on transform
  for an animated element — they fight and the movement stutters.
- **Absolutely-positioned motion cards need explicit z-index awareness.** The
  carousel arrows were unclickable because the cards had z-indexes and the
  arrows did not.

## Discord Rich Presence

Opt-in, off by default, configured in Settings with an application ID from the
Discord developer portal. `discord-presence.ts` speaks the IPC protocol directly
— four opcodes and a length-prefixed JSON frame — rather than depending on
`discord-rpc`, which is unmaintained and pulls in an OAuth stack this needs none
of. Nothing contacts Discord's servers; it writes to the local client's named
pipe. If Discord is not running, connection fails and presence stays off.

`timestamps.end` is what produces the countdown. Frame length is measured in
**bytes**, not characters — a title like `ソラニン` desyncs the stream otherwise.

Artwork sends the TMDB poster URL, which newer clients resolve directly; older
ones need an asset key uploaded to the application (`poster` is the fallback).
Confirmed working: Discord rewrites the URL to `mp:external/…` and serves it, so
per-film posters need no uploaded assets.

The **application ID** is the whole identity of the presence: Discord looks it up
to get the name shown on the first line. That name comes from the developer
portal, not from this codebase. No other portal configuration is required.

Two traps cost real debugging time here, both silent:

- **Frames sent before `READY` are discarded.** Discord dispatches `READY` after
  the handshake; anything written earlier vanishes, which showed up as a presence
  with the app name and a default elapsed timer but no title or artwork.
- **`connect()` must be safe under concurrency.** Two calls in the same tick each
  opened a socket and each overwrote a single `#onReady` slot, orphaning the
  first. The orphan timed out four seconds later and called `disconnect()`,
  tearing down the *live* connection its successor was using — presence appeared,
  then vanished after ~2s. The player triggers this every time: its effect and
  cleanup both fire, and StrictMode double-invokes on mount. In-flight attempts
  are now shared and a generation counter stops a superseded attempt from
  disconnecting its successor. `discord-presence.test.ts` runs a stub Discord
  over a real named pipe to hold this.

`scripts/discord-probe.ts <appId>` connects, handshakes and sends one activity,
logging every frame — the fastest way to tell a protocol fault from an app one.

## Conventions

- **Commits**: conventional prefix, lowercase, terse (2–5 words), subject only,
  no body, no trailers. `feat: stage carousel`, `fix: sidebar scrollbar gutter`.
- Comments explain *why*, especially where the obvious approach was wrong.
  Several exist purely to stop a trap above being reintroduced.
- Tests use real data from the library — the misspelled folders (`American
  Psyco`, `The Day After Tomarrow`, `Soranin`) are permanent fixtures.

## State

**Working:** scan, TMDB enrichment with fuzzy matching and manual re-match,
profiles, poster picker, Continue Watching, the player (seek, subtitles with
`V` cycling, hover scrub preview, ±10s, speed, brightness), acrylic translucency.

**Known gaps:**

- **Library roots are hardcoded to `D:/Movies`** in `config.ts`, with no folder
  picker and no IPC to change them. A fresh install on any other machine scans
  a path that does not exist and shows an empty library with no explanation.
  This is the blocker for anyone else installing the app.
- **`.mkv` and 10-bit HEVC do not play.** Chromium can't decode them; the player
  shows a clear error naming the format. Bundling mpv is the real fix and also
  solves HDR tone mapping properly.
- **Series is unwired.** The Movies/Series toggle is UI only — no series files
  exist and the scanner has no season/episode model.
- **`lib/selectors.ts` has no tests** despite load-bearing null handling.
- **The grid is not virtualized.** Fine at 79; not at thousands.
- **Profile rename** exists in the store and IPC but has no UI.

**Unresolved:** `library.json` was once found reverted to an older version with
its original mtime, while `library.backup.json` held the correct data. Never
reproduced. OneDrive is running on this machine and is the only plausible
external actor, but that was never proven. If enriched metadata vanishes,
restore from the backup file and suspect the environment before the code.
