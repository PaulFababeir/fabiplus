import { sep } from 'node:path';

/**
 * True when `child` is `parent` itself or sits beneath it.
 *
 * This is the containment check behind the `movie://` protocol and the subtitle
 * and colour-probe IPC handlers — the boundary that stops a path arriving from
 * the renderer reaching outside the configured library folders.
 *
 * Two details carry the whole thing:
 *
 * - **The separator.** A plain `startsWith` would treat `D:/Movies-private` as
 *   inside `D:/Movies`, handing over a sibling directory the user never chose.
 * - **The case fold.** Windows paths are case-insensitive, so comparing
 *   verbatim would let `d:/movies/...` slip past a root stored as `D:/Movies`.
 *
 * Callers must pass absolute, already-resolved paths. Resolving symlinks
 * *before* this runs is what stops a link inside the library pointing out of
 * it; this function cannot see through one.
 */
export function isInside(child: string, parent: string): boolean {
  const a = child.toLowerCase();
  const b = parent.toLowerCase();
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}
