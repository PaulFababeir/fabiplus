#!/usr/bin/env node
/**
 * Pre-push gate: every check a push depends on, run in order, reported as one
 * table.
 *
 *   npm run preflight             everything
 *   npm run preflight -- --quick  skips the production build and bundle sizes
 *
 * Exits 1 when anything FAILs. A WARN does not block, but it is a decision to
 * make before pushing, not noise to scroll past.
 *
 * Each check exists because its absence has already cost something here: a
 * typecheck that read no files, a CSS class that rendered as "undefined", a
 * whole-store subscription that redrew the app 132 times per progress event, a
 * TMDB key that crossed to the renderer. See CLAUDE.md.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: the latter keeps "%20" for the space in
// "D:\Code Project" and points every check at a directory that does not exist.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--quick');

/*
 * Renderer bundle budgets. The app loads its bundle from disk, so this is not
 * about download time — it is a tripwire for a dependency or an accidental
 * import landing in the renderer unnoticed. Raise them deliberately, with a
 * reason, never just to make the warning go away.
 */
const BUDGET_JS_KB = 1150;
const BUDGET_CSS_KB = 130;

/** The one key-shaped string history is allowed to contain: a fake JWT. */
const KNOWN_FAKE_SECRET_FILES = new Set(['src/main/services/metadata/tmdb.test.ts']);

const ANSI = /\x1b\[[0-9;]*m/g;
const results = [];

function run(command) {
  const started = performance.now();
  const proc = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  return {
    code: proc.status ?? 1,
    out: `${proc.stdout ?? ''}${proc.stderr ?? ''}`.replace(ANSI, ''),
    seconds: (performance.now() - started) / 1000
  };
}

function record(status, name, detail, seconds = null) {
  results.push({ status, name, detail, seconds });
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// --- 1. Working tree -------------------------------------------------------
{
  const git = run('git status --porcelain');
  const dirty = git.out.split(/\r?\n/).filter(Boolean);
  if (dirty.length === 0) record('PASS', 'Working tree', 'clean — what is tested is what gets pushed');
  else
    record(
      'WARN',
      'Working tree',
      `${dirty.length} uncommitted — a push sends commits, so these checks cover more than the push does`
    );
}

// --- 2. Typecheck ----------------------------------------------------------
{
  const r = run('npm run typecheck');
  const errors = (r.out.match(/error TS\d+/g) ?? []).length;
  if (r.code === 0) record('PASS', 'Typecheck', 'tsc --build', r.seconds);
  else record('FAIL', 'Typecheck', `${errors || 'some'} type errors — run npm run typecheck`, r.seconds);
}

// --- 3. Tests, with one retry so a flaky test is named rather than hidden ---
{
  const tally = (out) => ({
    tests: Number(out.match(/^ℹ tests (\d+)/m)?.[1] ?? NaN),
    fail: Number(out.match(/^ℹ fail (\d+)/m)?.[1] ?? NaN),
    failing: [...out.matchAll(/^\s*✖ (.+?)(?: \([\d.]+m?s\))?$/gm)].map((m) => m[1].trim())
  });

  const first = run('npm test');
  const a = tally(first.out);
  if (first.code === 0 && a.fail === 0) {
    record('PASS', 'Tests', `${a.tests} passed`, first.seconds);
  } else {
    const second = run('npm test');
    const b = tally(second.out);
    const names = [...new Set(a.failing)].slice(0, 3).join('; ') || 'unnamed';
    if (second.code === 0 && b.fail === 0) {
      record('WARN', 'Tests', `flaky — failed once, passed on retry: ${names}`, first.seconds + second.seconds);
    } else {
      record('FAIL', 'Tests', `${b.fail} failing: ${names}`, first.seconds + second.seconds);
    }
  }
}

// --- 4. Production build and bundle budgets --------------------------------
if (QUICK) {
  record('SKIP', 'Build', '--quick');
} else {
  const r = run('npm run build');
  if (r.code !== 0) {
    record('FAIL', 'Build', 'npm run build failed', r.seconds);
  } else {
    record('PASS', 'Build', 'tsc --build && electron-vite build', r.seconds);

    const assets = walk(path.join(ROOT, 'out', 'renderer', 'assets'));
    const kb = (ext) =>
      assets.filter((f) => f.endsWith(ext)).reduce((sum, f) => sum + fs.statSync(f).size, 0) / 1024;
    const js = kb('.js');
    const css = kb('.css');
    const over = [];
    if (js > BUDGET_JS_KB) over.push(`JS ${js.toFixed(0)} KB > ${BUDGET_JS_KB}`);
    if (css > BUDGET_CSS_KB) over.push(`CSS ${css.toFixed(0)} KB > ${BUDGET_CSS_KB}`);
    record(
      over.length ? 'WARN' : 'PASS',
      'Bundle size',
      over.length
        ? `over budget: ${over.join(', ')}`
        : `JS ${js.toFixed(0)} / ${BUDGET_JS_KB} KB, CSS ${css.toFixed(0)} / ${BUDGET_CSS_KB} KB`
    );
  }
}

// --- Native binaries that arrive outside npm's own install ------------------
{
  /*
   * Both of these are downloaded by something other than npm unpacking a
   * package, so a successful install proves nothing about either.
   *
   * Electron 43.8 fetches its binary on first `require('electron')`;
   * electron-vite reads path.txt directly and never triggers that, which is how
   * `npm run dev` died with "Electron uninstall". `predev` repairs it, so a
   * missing one is only a warning.
   *
   * ffmpeg.exe comes from ffmpeg-static's install script, which npm 11 runs only
   * when package.json's `allowScripts` approves that exact version. Without it,
   * `npm run dist` builds an installer that cannot convert audio and nothing
   * errors until a film fails to play — so that one fails the gate.
   */
  const require = createRequire(path.join(ROOT, 'package.json'));
  const problems = [];
  let electronNote = '';

  try {
    const dir = path.dirname(require.resolve('electron'));
    const wanted = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    const pathTxt = path.join(dir, 'path.txt');
    const versionFile = path.join(dir, 'dist', 'version');
    const exe = fs.existsSync(pathTxt) ? path.join(dir, 'dist', fs.readFileSync(pathTxt, 'utf8')) : null;
    const have = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null;
    if (!exe || !fs.existsSync(exe)) problems.push(['WARN', 'Electron binary missing — npm run dev repairs it']);
    else if (have !== wanted) problems.push(['WARN', `Electron binary is ${have}, package is ${wanted}`]);
    else electronNote = `Electron ${have}`;
  } catch {
    problems.push(['WARN', 'electron package not installed']);
  }

  let ffmpegNote = '';
  try {
    const ffmpeg = require('ffmpeg-static');
    if (!ffmpeg || !fs.existsSync(ffmpeg)) {
      problems.push([
        'FAIL',
        'ffmpeg.exe missing — npm run dist would ship without audio conversion. ' +
          'Approve its install script (npm approve-scripts ffmpeg-static), then npm rebuild ffmpeg-static'
      ]);
    } else {
      ffmpegNote = `ffmpeg ${(fs.statSync(ffmpeg).size / 1024 / 1024).toFixed(0)} MB`;
    }
  } catch {
    problems.push(['FAIL', 'ffmpeg-static not installed']);
  }

  const status = problems.some(([s]) => s === 'FAIL') ? 'FAIL' : problems.length ? 'WARN' : 'PASS';
  record(
    status,
    'Native binaries',
    problems.length ? problems.map(([, m]) => m).join('; ') : `${electronNote}, ${ffmpegNote} — both present`
  );
}

// --- 5. Dependency audit ----------------------------------------------------
{
  const r = run('npm audit --json');
  let report = null;
  try {
    report = JSON.parse(r.out.slice(r.out.indexOf('{')));
  } catch {
    // Offline, or the registry is down: say so rather than report a pass.
  }

  if (!report?.metadata) {
    record('WARN', 'Dependency audit', 'could not run — offline or registry unreachable', r.seconds);
  } else {
    const v = report.metadata.vulnerabilities;
    const serious = v.high + v.critical;
    const names = Object.keys(report.vulnerabilities ?? {});
    // Electron is a devDependency, but it is the runtime every user gets.
    const shipped = names.filter((n) => n === 'electron' || n in (readPackage().dependencies ?? {}));
    const detail =
      `${v.critical} critical, ${v.high} high, ${v.moderate} moderate` +
      (names.length ? ` — ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}` : '') +
      (shipped.length ? `; ships to users: ${shipped.join(', ')}` : '');
    record(serious ? 'FAIL' : v.moderate + v.low ? 'WARN' : 'PASS', 'Dependency audit', detail, r.seconds);
  }
}

function readPackage() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

// --- 6. CSS module classes every component reads actually exist ------------
{
  /*
   * TypeScript cannot see into a stylesheet: `styles.missing` is undefined at
   * runtime, renders as class="undefined", and nothing errors anywhere.
   */
  const IMPORT = /import\s+(\w+)\s+from\s+'(\.[^']+\.module\.css)'/g;
  const missing = [];
  let checked = 0;
  for (const file of walk(path.join(ROOT, 'src', 'renderer', 'src')).filter((f) => f.endsWith('.tsx'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [, binding, rel] of src.matchAll(IMPORT)) {
      const css = fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8');
      const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
      for (const [, name] of src.matchAll(new RegExp(`\\b${binding}\\.(\\w+)`, 'g'))) {
        checked += 1;
        if (!defined.has(name)) missing.push(`${path.basename(file)}: ${binding}.${name}`);
      }
    }
  }
  if (checked < 100) record('FAIL', 'CSS classes', `only ${checked} references found — the check itself is broken`);
  else if (missing.length) record('FAIL', 'CSS classes', `${missing.length} undefined: ${missing.slice(0, 3).join('; ')}`);
  else record('PASS', 'CSS classes', `${checked} references, all defined`);
}

// --- 7. Whole-store subscriptions on the library store ----------------------
{
  /*
   * `useLibrary()` with no selector re-renders on every store change, and
   * enrichment changes it once per title. In App.tsx that redrew the whole
   * window 132 times per progress event. Only the library store is checked:
   * it is the one that changes several times a second.
   */
  const offenders = [];
  for (const file of walk(path.join(ROOT, 'src', 'renderer', 'src')).filter((f) => /\.tsx?$/.test(f))) {
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/\buseLibrary\(\s*\)/.test(code) && !/^\s*\*/.test(line)) {
          offenders.push(`${path.basename(file)}:${i + 1}`);
        }
      });
  }
  record(
    offenders.length ? 'WARN' : 'PASS',
    'Store subscriptions',
    offenders.length
      ? `useLibrary() without a selector re-renders on every progress event: ${offenders.join(', ')}`
      : 'every useLibrary() call selects only what it reads'
  );
}

// --- 8. Secrets in tracked files and in history -----------------------------
{
  const BINARY = /\.(png|ico|gif|jpe?g|webp|avif|woff2?|ttf|exe|zip|mp4|mkv)$/i;
  const PATTERNS = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
    ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
    ['hex key in a key-ish line', /(?:api|key|token|secret)[^\n]{0,40}\b[0-9a-f]{32}\b/i]
  ];

  const tracked = run('git ls-files').out.split(/\r?\n/).filter((f) => f && !BINARY.test(f));
  const hits = [];
  for (const rel of tracked) {
    if (KNOWN_FAKE_SECRET_FILES.has(rel)) continue;
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const [label, re] of PATTERNS) if (re.test(text)) hits.push(`${rel} (${label})`);
  }

  /*
   * The decisive check: this machine's real TMDB key, read from the app's own
   * config and compared in memory against every tracked file and every commit
   * in history. Never printed, never passed on a command line.
   */
  let realKeyNote = 'no local TMDB key to compare';
  const configFile = path.join(
    process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
    'movie-app',
    'config.json'
  );
  try {
    const key = JSON.parse(fs.readFileSync(configFile, 'utf8')).tmdbApiKey;
    if (typeof key === 'string' && key.length >= 16) {
      const inTree = tracked.some((rel) => {
        const full = path.join(ROOT, rel);
        return fs.existsSync(full) && fs.readFileSync(full, 'utf8').includes(key);
      });
      const history = run('git log --all -p --no-color --no-ext-diff');
      const inHistory = history.out.includes(key);
      if (inTree || inHistory) hits.push(`your real TMDB key is in ${inTree ? 'a tracked file' : 'git history'}`);
      realKeyNote = 'your real TMDB key appears in no tracked file and no commit';
    }
  } catch {
    // No config on this machine — nothing to compare against.
  }

  record(
    hits.length ? 'FAIL' : 'PASS',
    'Secrets',
    hits.length ? hits.slice(0, 4).join('; ') : `${tracked.length} files clean; ${realKeyNote}`
  );
}

// --- 9. Where this push lands ------------------------------------------------
{
  const version = readPackage().version;
  const lastTag = run('git describe --tags --abbrev=0').out.trim().split(/\r?\n/).pop();
  const since = run(`git rev-list --count ${lastTag}..HEAD`).out.trim();
  const ahead = run('git rev-list --count @{u}..HEAD').out.trim();
  record(
    'INFO',
    'Push',
    `v${version}; ${since} commit(s) since ${lastTag}; ${/^\d+$/.test(ahead) ? ahead : '?'} ahead of upstream`
  );
}

// --- Report ------------------------------------------------------------------
const ICON = { PASS: '✔', FAIL: '✖', WARN: '⚠', SKIP: '–', INFO: 'ℹ' };
const width = Math.max(...results.map((r) => r.name.length));
console.log(`\nPreflight — ${readPackage().name} ${readPackage().version}\n`);
for (const r of results) {
  const time = r.seconds === null ? '' : `  ${r.seconds.toFixed(1)}s`;
  console.log(`  ${ICON[r.status]} ${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}${time}`);
}

const failed = results.filter((r) => r.status === 'FAIL').length;
const warned = results.filter((r) => r.status === 'WARN').length;
console.log(
  `\n${failed ? `FAIL — ${failed} failing` : 'PASS'}${warned ? `, ${warned} warning${warned === 1 ? '' : 's'}` : ''}` +
    `${failed ? ' — do not push until these are fixed.' : ''}\n`
);
process.exit(failed ? 1 : 0);
