# movie-app

Offline desktop movie library and player for a local collection at `D:/Movies`
(86 films and 1 show, ~172 GB). Electron + React + TypeScript. No cloud, no
account, no telemetry — the only network call is TMDB metadata enrichment, and
everything it returns is cached to disk so the app runs with the network off.

## Commands

```bash
npm run dev          # electron-vite dev, HMR on the renderer
npm start            # run the production build
npm run build        # tsc --build && electron-vite build
npm test             # 258 tests, node:test via tsx
npm run typecheck    # tsc --build — see below, --noEmit checks nothing here
npm run scan:report  # print the parse table for every folder, no network
npm run dist         # NSIS installer into release/ (~118 MB)
npm run release      # same, published to GitHub Releases
```

Only one instance can run at a time (`requestSingleInstanceLock`). Launching a
second focuses the first — it will look like nothing happened. Editing anything
under `src/main/` or `src/preload/` restarts the app; renderer edits hot-reload.

## Layout

```
src/main/          Electron main. Scanner, TMDB provider, matcher, stores.
                   All 258 tests live here or in shared.
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

**The data directory is pinned in `main/index.ts`; do not remove that line.**

```ts
app.setPath('userData', join(app.getPath('appData'), 'movie-app'));
```

Electron derives `userData` from `app.getName()`, which returns `productName`
when set. `productName` is `Fabi+` — a display name — so without the pin the
data directory would follow it to `%APPDATA%/Fabi+`, orphaning the catalog,
profiles and image cache in one release. Watch history is not regenerable.

That also closes a dev/production split: unpackaged runs took the name from
`package.json` (`movie-app`) and packaged ones from `build.productName`, so the
two diverged the moment those differed. The literal `movie-app` is now the only
thing that decides, and **renaming the app is safe** as long as the pin stays.

`artifactName` is deliberately the literal `movie-app-${version}-setup.${ext}`
rather than `${productName}-…`. It keeps the installer filename ASCII — a `+`
in a release asset URL is a hazard for `electron-updater` — and keeps the name
stable across renames, so an existing update feed keeps resolving.

Updates are **manual only**, from Settings. Everything else works offline and a
background updater phoning home each launch would break that. Windows cannot
replace a running executable, so the installer downloads to temp and applies on
quit. Unsigned, so SmartScreen warns on first run.

### Cutting a release

Nothing publishes on its own. `.github/workflows/release.yml` runs on a pushed
`v*` tag and nothing else:

```bash
npm version patch        # bumps package.json, commits, creates the tag
git push --follow-tags
```

It refuses to build when the tag disagrees with `package.json`, since that
produces assets named for one version and a feed advertising another.

electron-builder uploads the installer, `latest.yml` and the blockmap to a
**draft** release. Drafts are invisible to `electron-updater`, so the release
must be published in the GitHub UI before Settings → Check for updates sees it.

`npm run release` does the same thing locally, but needs `GH_TOKEN` set to a
personal access token with `repo` scope. Inside Actions the built-in
`GITHUB_TOKEN` covers it.

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
| `cache/images/` | Posters, backdrops, episode stills | Yes |
| `cache/avatars/` | Profile pictures, copied in | **No** |

The split is deliberate: a corrupt catalog or a full rescan must never be able
to touch watch history. Every write goes through `writeJsonAtomic` (temp file +
rename). Never write profile data in place.

`cache/avatars/` sits outside `cache/images/` for the same reason: the artwork
cache is disposable and can be cleared to reclaim disk, and an avatar is a copy
of a file the user chose that nothing can refetch.

## Decisions worth not relitigating

- **TMDB, not Letterboxd.** Letterboxd has no open API and sources its artwork
  from TMDB anyway. Sits behind a `MetadataProvider` interface if that changes.
- **Electron over Tauri.** WebView2 cannot decode the library's `.mkv` and
  10-bit HEVC files; a bundled player is needed either way, and Electron makes
  that far easier.
- **JSON, not SQLite.** 87 items. Swap `library.json` alone if it ever passes a
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

**A show's cast is not in `credits`.** `/tv/{id}?append_to_response=credits`
returns series-level billing only — for Sherlock that is two people, and the
sidebar showed exactly those two. The rest live in `aggregate_credits`, which
rolls up every episode and puts the character under `roles[]` because one actor
can play several parts across a run; the role with the most episodes is the one
worth naming. That endpoint is TV-only, so films still ask for `credits` alone.
It also returns *everyone* who ever appeared, which is why series cast is capped
at `MAX_SERIES_CAST` (10) rather than the films' 30.

**Backdrops are cached at two sizes, and only one of them is the big one.** A
film caches twenty backdrops but only ever *shows* one, so
`CachedImage.localPath` holds a w500 preview sized for the picker grid and
`fullPath` holds the original — fetched at enrichment for `backdrops[0]` and on
demand, through `library:backdrop-full`, the first time a profile picks any of
the others.
Caching twenty originals to display one cost about seven times the disk for
pixels nothing drew: ~12MB a film against ~2MB.

Three things follow. `backdropFor` returns `fullPath ?? localPath`, so a
freshly picked backdrop is briefly soft rather than missing, and a catalog
written before the split still resolves. `withBackdropFull` must move the legacy
`metadata.backdrop` scalar too when index 0 is upgraded, because that scalar
*is* `backdrops[0]`. And the upgrade is fire-and-forget — it must never block
the dialog or flag the library busy, since the chosen backdrop is already on
screen.

**Displaying a backdrop is what triggers the upgrade, not picking one.**
`useFullBackdrop` runs in `BackdropLayer` and the Continue Watching stage.
Firing it from the picker alone was not enough and shipped visibly broken: a
choice made in an earlier session never passes through the picker again, so
every profile with saved picks — nine of them here — kept showing 28KB previews
where a 629KB original existed one fetch away.

**The artwork cache is keyed by URL, not by the provider path.** TMDB puts the
size in the URL, so the path alone does not identify what was fetched. Keying on
it meant raising `BACKDROP_SIZE` found the old w780 file already on disk and
kept serving it — the larger image would never arrive, no matter how many times
the user ran Refetch all, and nothing anywhere would report a problem. Changing
any size constant now simply produces new entries; the superseded ones are
orphans in a cache that is disposable by design.

**`KindFilter` is not a `MediaKind`.** The library view can show `all`, but no
`LibraryItem` is ever `all` and the provider has one endpoint per kind with
nothing to search for "both". Widening `MediaKind` would put `all` in reach of
`searchProvider` and `fetchDetails`, where it means nothing — so the view type
lives beside `SortKey` and `matchesKind` is the only thing that reads it.

**Avatars are re-encoded on the way in, and a GIF must not be.** A phone photo
is 4000px and several MB, all of which was decoded to paint a 32px chip and the
row tint; `compressedAvatar` shrinks it once to a 512px JPEG. GIF is excluded on
purpose — `nativeImage` returns the first frame only, so re-encoding silently
turns an animated avatar into a still. PNG stays PNG for its alpha. Anything the
decoder cannot read comes back empty and is copied untouched, which is also what
happens to a re-encode that came out no smaller.

**TMDB artwork.** Do not send `include_image_language`. Restricting to `en,null`
starves non-English films — Solanin had exactly one usable poster because the
rest are tagged `ja`. Fetch every language, rank client-side in `rankImages`.
Posters rank English-first (title art reads better at thumbnail size);
backdrops prefer textless plates.

**MP4 cannot hold SubRip, and `-c:s copy` fails the whole conversion.** The
audio remux carried `-c:s copy`, so any file needing converted audio *and*
holding embedded subtitles — 10 of the 11 such files in this library, and most
of any modern WEB-DL — died on "Could not find tag for codec subrip" and was
simply unplayable. It is `-sn` now: subtitles are read from the *original*
file by `embedded-subs.ts`, never from the converted copy, so dropping forty
tracks costs nothing and is faster besides. Never reintroduce a subtitle codec
here without checking it against the MP4 container.

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

**`tsc --noEmit` type-checks nothing in this repo.** The root `tsconfig.json` is
a solution file — `"files": []` plus references to the node and web projects —
and `--noEmit` does not traverse project references, so it exits 0 having read
no source at all. It must be `tsc --build`. This was wrong for a long time and
hid fifteen real errors, including a test asserting against a field that had
been renamed. Relatedly, the web project must **exclude** `*.test.ts`: tests are
node programs, and compiled under the renderer's `types` every `node:` import
fails.

**Catalog merge logic lives in `library-merge.ts`, not `library.ts`.** The
latter reaches `config.ts` for file paths, which imports `electron` — so
anything importing it dies under `node:test` with "does not provide an export
named 'app'". `mergeScan` and `wouldDestroyMetadata` are the code that can
destroy an enriched catalog, so they sit in a module a test can actually load.
`library.ts` re-exports them; callers are unaffected.

**The app icon lives in `assets/`, not `build/`.** electron-builder's default
`buildResources` location is `build/`, which `.gitignore` excludes as build
output — an icon put there is never committed and every clean checkout silently
falls back to the Electron logo. `win.icon`, `nsis.installerIcon` and
`nsis.uninstallerIcon` therefore point at `assets/icon.ico` explicitly. It is
the photo-portfolio mark, rasterised from that project's `favicon.svg`, and it
must carry a 256×256 entry or electron-builder refuses it.

**`movieRoots` defaults to empty, deliberately.** It was `['D:/Movies']`, which
scanned nothing on any other machine and showed a blank grid with no
explanation. The folder picker (`config:pick-folder`) and the first-run empty
state in `App.tsx` are what replace it. Relatedly, `wouldDestroyMetadata` takes
the roots and returns false when there are none: removing the last folder is a
deliberate act, and without that the catalog refuses to empty and the films stay
on screen.

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

**Watch progress is keyed by `Episode.id` for a show, not the show's id.** So
`continueWatching` resolves each entry against a map of *both* item ids and
episode ids, and `ContinueEntry` carries the episode alongside the show. A
straightforward `new Map(items.map(i => [i.id, i]))` looks equivalent and
silently drops every part-watched episode from the deck — which is exactly how
it behaved before. The card has to name the episode too, or a show with forty of
them says nothing about which one it is offering.

**The last profile cannot be deleted, and the store is what enforces it.**
`deleteProfile` throws `LastProfileError`; the hidden button in `ProfileMenu` is
a convenience, not the guard. An empty `profiles.json` is not merely odd —
`ensureProfile` mints a replacement on the next launch and every
`profiles/<id>.json` beside it becomes an orphan nothing references. The rule
lives in `profile-rules.ts` (`wouldEmptyProfiles`) rather than `profiles.ts` for
the usual reason: the latter reaches `config.ts`, which imports `electron`, so
no test can load it. Same split as `library-merge.ts`.

**React StrictMode double-invokes effects.** `ensureProfile` is serialised
behind a shared promise because two concurrent calls both saw an empty list,
both created a profile, and the second write orphaned the first — taking its
poster choices with it.

**`@shared/*` is a build-time alias.** Type-only imports are erased so they work
anywhere; **value** imports need runtime resolution, which is why `npm test`
passes `--tsconfig tsconfig.node.json`.

**Icon-only buttons go through `ui/IconButton`.** There were five hand-rolled
versions — three sizes, two shapes, and three of them changed only the glyph
colour on hover, which is nearly invisible on a dark surface and read as a dead
control. Worse, the modal header used a rounded square while the row-level
button beside it used a circle, with both on screen at once. Call sites pass a
`className` for **placement only**; anything affecting how it looks on hover
belongs in the component or the divergence starts again.

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
- **A drag region swallows its whole band, whatever is painted above it.**
  The player sets `-webkit-app-region: no-drag` on `.root` and `.chrome`
  because the shell’s strip was eating the back button. But the player also
  covers that strip, so a playing window could not be dragged to another
  monitor at all. `.dragBand` puts a 30px band back, and it has to be the
  **last child of `.root`**: Chromium walks the tree in order, unioning
  `drag` and subtracting `no-drag`, so `.chrome` — no-drag over `inset: 0` —
  erases any band declared before it. Declared earlier the band existed and
  did nothing, at any z-index. It also *stops* where the header’s content
  begins rather than sitting behind it, both heights coming from
  `--drag-band` so they cannot drift back into overlapping.
- **motion owns `transform`.** Never also put a CSS `transition` on transform
  for an animated element — they fight and the movement stutters.
- **Absolutely-positioned motion cards need explicit z-index awareness.** The
  carousel arrows were unclickable because the cards had z-indexes and the
  arrows did not.

## Discord Rich Presence

Opt-in, off by default — a single toggle in Settings, nothing to configure.
`discord-presence.ts` speaks the IPC protocol directly
— four opcodes and a length-prefixed JSON frame — rather than depending on
`discord-rpc`, which is unmaintained and pulls in an OAuth stack this needs none
of. Nothing contacts Discord's servers; it writes to the local client's named
pipe. If Discord is not running, connection fails and presence stays off.

`timestamps.end` is what produces the countdown. Frame length is measured in
**bytes**, not characters — a title like `ソラニン` desyncs the stream otherwise.

Artwork sends the TMDB poster URL, which newer clients resolve directly.
Confirmed working: Discord rewrites the URL to `mp:external/…` and serves it, so
per-film posters need no uploaded assets.

**Nothing sends a bare asset key, and nothing should.** `FALLBACK_ART` used to be
the literal `'poster'` — a key that only resolves if someone uploaded an asset by
that name under Rich Presence → Art Assets, and nobody ever had. Discord could
not resolve it and drew its own broken-image placeholder, which is what the idle
card showed from the very first launch until a film was picked. It is now
`APP_ICON_URL`, the app icon served from the public repo over https, so the
artwork is self-sufficient in every state. A URL is the only kind of value that
does not depend on the developer portal, and `presence.test.ts` holds the line
with a test that every state's `largeImage` starts with `https://`.

That URL is pinned to `main`, so `assets/icon.png` has to be pushed before it
resolves — it is extracted from the 256×256 entry of `assets/icon.ico`, which is
already PNG-encoded, and the `.ico` itself is no use here because GitHub serves
it as `image/vnd.microsoft.icon`.

It follows the profile's poster pick, so the presence shows the same artwork the
library does. Note this sends `remotePath`, **not** the cached `localPath` the UI
renders — Discord fetches the image from its own servers and a path on this disk
is meaningless to it. An out-of-range pick falls back to the first poster, since
a choice outlives a refetch that returns fewer posters.

The **application ID is bundled** as `DISCORD_APP_ID` in `shared/constants.ts`,
not asked for in Settings. It is a public identifier, not a credential: it is
already broadcast in every presence payload to anyone who can see the profile,
and grants nothing on its own — the client secret and bot token are the secrets,
and neither is used, since Rich Presence over the local socket is unauthenticated.
Requiring every user to register their own application was setup friction for no
benefit; all the ID decides is whose application *name* appears on the first line
while browsing.

`config.discordAppId` survives as an override so an install that already stored
one keeps it (`config.discordAppId ?? DISCORD_APP_ID`). Nothing writes it now.

### What it publishes

`shared/presence.ts` maps app state to one of four activities, and is pure so
the branching is tested without a socket:

Discord renders `details` prominently and `state` as grey subtext, which is why
the year and genre sit in `state`:

| State | First line | Prominent | Subtext | Timer |
|---|---|---|---|---|
| Playing | `Watching <title>` | — | `<app> · 2013 · Horror` | countdown |
| Paused | `Watching <title>` | `Paused` | `<app> · 2013 · Horror` | none |
| Film selected | app name | `Farming My Letterboxd` | that film's title | none |
| Idle | app name | `Farming My Letterboxd` | `79 films` | none |

While playing, the prominent line is deliberately empty — the countdown takes it.

The **app name in the subtext is learned from Discord, never configured.** It
lives in the developer portal, so the app cannot know it up front; Discord fills
`name` in on any activity that does not override it, and the browsing activity
— always the first published — does exactly that. `presence.appName` caches it,
the IPC call returns it, and the hook re-publishes once with it. Do not add a
settings field for this: it would duplicate the portal and drift from it.

The local RPC honours both `type` (3 = Watching) and a **`name` that overrides
the application name** — verified against the desktop client, which echoes both
back. That is what puts the film itself on the first line instead of the app.
`DiscordActivity` therefore uses Discord's own field names: `name` is line one,
`details` line two, `state` line three. Guessing that mapping wrong is invisible
until you look at a profile.

A film takes the first line; browsing deliberately does not, because the app
name is the only thing identifying the app when no film is open. A client that
ignored either field would just show "Playing &lt;app name&gt;", so this degrades
quietly rather than breaking.

**Never send `null` while the app is open.** Clearing the Rich Presence does not
leave the profile blank — Discord falls back to its own detected-app line, which
is the app name and an elapsed timer with no title or artwork. That fallback is
exactly what looks like "presence is broken". The presence is only cleared when
the process exits and the socket closes.

The countdown is dropped when paused because `timestamps.end` is an absolute
wall-clock instant: leaving it set counts down a film that is not moving.

`useDiscordPresence` at the app shell is the **only** writer. It used to live in
the player, which could not describe the library view and cleared the presence on
unmount. Playback is mirrored into `useUi.playback` on play/pause and about once
a minute — not per `timeupdate`, which would re-render the shell several times a
second. The hook compares the built activity by value before sending, because the
shell re-renders on every keystroke in the search box; `presenceEpoch` exists to
force a publish when the Discord settings change, which the value check would
otherwise swallow.

Three traps cost real debugging time here, all silent:

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

## Security posture

The repo is public. Nothing secret has ever been committed — the TMDB key lives
in `%APPDATA%/movie-app/config.json`, which is outside the repo, and the only
key-shaped string in history is a deliberately fake JWT in `tmdb.test.ts`.

The renderer is treated as untrusted. That is not paranoia about the user; it is
what keeps a bug in a subtitle file, a filename, or a TMDB response from
becoming file-system access.

- `contextIsolation: true`, `nodeIntegration: false`. The preload is the entire
  API surface.
- `sandbox: false` is **forced by the ESM preload** — Electron only loads
  sandboxed preloads as CommonJS, and electron-vite emits `index.mjs`. The pair
  above plus the CSP is what carries the weight instead. Do not "fix" this
  without also converting the preload.
- CSP in `index.html`: no `unsafe-eval`, `script-src 'self'`. `style-src` needs
  `'unsafe-inline'` for motion's inline transforms.
- `hardenWebContents()` denies renderer-opened windows, navigation and webview
  attachment. A renderer-opened window inherits the preload and with it
  `window.api`; the CSP governs what a document may *load*, never where the top
  frame may *go*. Nothing navigates the top frame, so a flat deny is correct.
- **The one outward link goes through main, and takes an id rather than a URL.**
  `app:open-letterboxd` receives a TMDB id and builds the address itself, so a
  bug in the renderer cannot hand `shell.openExternal` an arbitrary target —
  that call will pass anything to the OS. The worst a caller can do is open the
  wrong film. Any future external link should be shaped the same way.
- Every path from the renderer goes through `resolveAllowedPath` — `movie://`,
  `subtitleLoad` and `videoColour` alike. It calls `realpath` **before**
  `isInside`, so a symlink inside the library cannot point out of it.
- `isInside` lives in `path-containment.ts`, apart from `index.ts`, purely so it
  can be tested — it is the actual traversal boundary and `index.ts` imports
  `electron`, which no test can load. Its separator check is what stops
  `D:/Movies-private` passing as inside `D:/Movies`.
- Cache filenames are SHA-1 digests, so a hostile `remotePath` cannot escape the
  cache directory.

`npm audit` is clean; keep it that way before tagging a release.

## Conventions

- **Commits**: conventional prefix, lowercase, terse (2–5 words), subject only,
  no body, no trailers. `feat: stage carousel`, `fix: sidebar scrollbar gutter`.
- Comments explain *why*, especially where the obvious approach was wrong.
  Several exist purely to stop a trap above being reintroduced.
- Tests use real data from the library — the misspelled folders (`American
  Psyco`, `The Day After Tomarrow`, `Soranin`) are permanent fixtures.

## Next up

Everything the previous list carried has shipped — the backdrop picker, mark as
watched, profile rename and image avatars, episodes in Continue Watching,
next-episode autoplay and episode stills. What is genuinely left is in `State`
below. Three things are worth knowing before adding to any of it.

**The scan owns files; the stored catalog owns everything else — at both
levels.** `mergeScan` preserves an item's `metadata` and `match` across a
rescan, and `mergeSeasons` does the same one layer down for episode titles,
runtimes and stills. Before that existed, `seasons` came straight off the scan
and every enriched episode field was silently discarded the next time anyone
scanned, with no way back short of a full refetch. **Anything added to `Episode`
that the provider supplies has to be listed in `mergeSeasons` or it will not
survive a rescan.** Episodes match by id, which is a hash of the file path, so a
renamed file correctly loses its enrichment rather than inheriting a stranger's.

**A new cache directory has to be added to `allowedRoots`.** `movie://` refuses
anything outside it, so `cache/avatars/` had to be listed there before an avatar
would render at all — and `media-server.ts` had to learn `.gif` and `.avif`,
because a file it cannot type is served as `application/octet-stream` and
Chromium declines to draw it. The avatar cache is deliberately *not* under
`cache/images/`: that one is disposable and gets cleared, and an avatar has
nothing to refetch it from.

**Read artwork through the selectors, never off `Metadata` directly.**
`posterFor` and `backdropFor` apply the profile's pick and absorb a stale one —
a choice outlives a refetch that returns fewer images. `backdropFor` checks the
`backdrops` list *first* and only falls back to the legacy `metadata.backdrop`
scalar when it is empty; doing it the other way round pins every profile to
`backdrops[0]` and silently ignores the pick, because the scalar is that same
image.

## State

**Working:** scan of both films and shows, TMDB enrichment with fuzzy matching
and manual re-match, profiles (create, switch, rename, image avatar, delete),
poster and backdrop pickers, Continue Watching for films and episodes alike with
a right-click "mark as watched", the series episode list with stills and
per-episode resume, next-episode autoplay, the player (seek, external and
embedded subtitles with `V` cycling, hover scrub preview, ±10s, speed,
brightness, on-demand audio conversion), acrylic translucency.

**Known gaps:**

- **AC-3, E-AC-3, DTS and TrueHD audio must be converted before it plays.**
  Measured on a real 50-minute DDP5.1 episode: about 200 seconds, not the
  "ten seconds" this file claimed for a long time. The video stream is copied
  bit-for-bit; the AAC encode is the cost. `-aac_coder fast` is worth 2.4x on
  the encoder in isolation, though end-to-end the mux and the `+faststart`
  pass dominate. The player pre-converts the *next* episode while one plays,
  so only the first file of a session ever waits. The container and the video
  codec are *not* the problem; Matroska and HEVC were both measured playing
  natively, and `audio-support.ts` is where that is recorded.
- **The grid plays a show by the show's own id.** `MovieGrid`'s play button
  passes `item.id` for anything it is handed, and for a series that resolves to
  `LibraryItem.video` — a stand-in for the first episode — with progress stored
  against the show rather than the episode. The episode list never sees it, so
  the same file can be half-watched in two places at once. `continueWatching`
  still resolves those ids so existing entries are not orphaned; the fix is for
  a show's card to open the sidebar instead of playing.
- **`lib/selectors.ts` has no tests** despite load-bearing null handling, and
  `backdropFor` has now joined `posterFor` there. The test runner only reaches
  `src/main`, `src/shared` and `scripts` — a renderer test would need
  `tsconfig.node.json` to include it, since `tsconfig.web.json` now excludes
  `*.test.ts`.
- **The grid is not virtualized.** Fine at 87; not at thousands.
- **An animated avatar is stored uncompressed.** `avatarEncoding` returns
  `copy` for a GIF because a decoder hands back only its first frame, so a
  30 MB animation is kept whole where a still would be shrunk to a few tens of
  KB. Same for any format `nativeImage` cannot decode.

**Unresolved — and now reproduced.** `library.json` reverts to its pre-run
contents after a successful enrichment, while `library.backup.json` keeps the
correct data. Seen again on 2026-08-09: the backup held 87 enriched films at
1,860,167 bytes while `library.json` was back to the 79 it had beforehand.

Two earlier assumptions were wrong and should not be repeated:

- **OneDrive is not the actor.** It runs on this machine, but `%APPDATA%\Roaming`
  is not redirected into it — only Camera Roll is.
- **The mtime evidence proves less than it looks.** `backupLibrary` uses
  `copyFile`, and Windows `CopyFileW` carries the source timestamps across, so a
  recovery done that way leaves `library.json` stamped older than its contents.
  "Reverted with its original mtime" is what a restore-from-backup looks like.

What is solid: `backupLibrary` copies `library.json`, so a backup holding data
the catalog does not means the catalog held it at that moment and lost it after.
A watcher polling every 10s across a whole refetch never caught `library.json`
holding the enriched content, so either the revert is faster than that or the
backup came from something the catalog never was. Both are still open.

`saveLibrary` now reads back what it wrote and throws on a mismatch, so the next
occurrence surfaces as an error instead of a silently discarded run. If enriched
metadata vanishes, restore from `library.backup.json` — it has been correct every
time — and suspect the environment before the code.
