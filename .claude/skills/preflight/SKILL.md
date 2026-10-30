---
name: preflight
description: Pre-push gate for movie-app. Run before any git push, tag, npm version, release or installer build, and whenever the user asks to check that nothing broke, run before-push tests, recheck for vulnerabilities, or confirm the app is ready to ship. Runs `npm run preflight` and explains what each result means and what to do about it.
---

# Preflight

`npm run preflight` runs every check a push depends on, in order, and prints
one table. Exit code 1 means **do not push**. It takes about 30 seconds.

`npm run preflight -- --quick` skips the production build and bundle sizes.
Use it while iterating; never as the final run before a push.

## When to run it

- Before `git push`, `npm version`, `npm run dist`, or anything that tags.
- When the user asks whether anything broke, whether it is ready to push, or to
  recheck vulnerabilities.
- After any dependency change, including `npm audit fix`.

## Reading the result

Lead the report with PASS or FAIL, then quote the lines that are not PASS.

| Check | Not passing means | What to do |
|---|---|---|
| Working tree | Uncommitted changes. A push sends commits, so the gate covered more than the push will. | Commit or stash, then rerun. |
| Typecheck | `tsc --build` found errors. | `npm run typecheck`, fix them. Never substitute `--noEmit`; it checks nothing in this repo. |
| Tests — WARN flaky | A test failed once and passed on retry. The line names it. | Report it by name. A flake that recurs is a bug, not noise. `discord-presence.test.ts`, which runs a stub Discord over a real named pipe, is the standing suspect. |
| Tests — FAIL | Failed twice. | Fix before pushing. |
| Build | The production bundle did not compile. | `npm run build` for the full output. |
| Bundle size | The renderer bundle passed its budget. | Something new landed in the renderer — find the import. Raise `BUDGET_JS_KB`/`BUDGET_CSS_KB` in `scripts/preflight.mjs` only with a stated reason. |
| Dependency audit | High or critical advisories. The line says which of them **ship to users**. | See below. |
| CSS classes | A component reads `styles.x` and no `.x` exists. It renders `class="undefined"` and nothing errors. | Add the class or fix the name. |
| Store subscriptions | `useLibrary()` called without a selector. It re-renders on every progress event — in `App.tsx` that once meant 132 renders per event. | Select each field: `useLibrary((s) => s.busy)`. |
| Secrets | A key-shaped string, or this machine's real TMDB key, is in a tracked file or in git history. | **Stop.** Do not push. If it is already in history, the key must be rotated — deleting a commit does not unpublish what was pushed. |
| Push | Version, commits since the last tag, commits ahead of upstream. | Information only. |

## Fixing a failing dependency audit

1. **Close the running app first** — the installed Fabi+ and any
   `npm run dev`. On Windows npm cannot replace
   `node_modules/electron/dist/electron.exe` while a process holds it, and an
   interrupted extract can leave Electron half-installed. Ask the user to close
   it; never kill their process.
2. `npm audit fix` — never `--force`, which takes major versions.
3. Rerun the full gate. A dependency bump is exactly the change this exists to
   catch.
4. Commit the lockfile on its own: `fix: patch audited deps`.

Electron is listed as a devDependency, but it is the runtime every user
receives, which is why the gate reports it as shipping. Treat it that way.

## Never

- Push with a FAIL in the table.
- Use `--quick` as the last run before a push.
- Print the TMDB key. The script compares it in memory and never outputs it.
