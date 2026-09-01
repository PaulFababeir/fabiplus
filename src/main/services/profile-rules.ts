import type { Profile } from '@shared/types';

/**
 * The rule that decides whether a profile may be removed.
 *
 * Apart from `profiles.ts` because that module reaches `config.ts` for the file
 * paths, which imports `electron` — nothing importing it can be loaded by a
 * test. This is the code that can orphan every watch record on disk, so it sits
 * in a module a test can actually load, the same way `library-merge.ts` does.
 */

/**
 * True when removing `id` would leave the app with no profiles at all.
 *
 * `ensureProfile` would then mint a fresh one on the next launch, and every
 * `profiles/<id>.json` still on disk belongs to a profile nothing references —
 * watch history that cannot be recovered, because nothing knows it is there.
 *
 * An id that is not in the list cannot empty anything, and neither can an
 * already-empty list; both are false rather than a refusal, so a delete of
 * something already gone stays a harmless no-op.
 */
export function wouldEmptyProfiles(profiles: Profile[], id: string): boolean {
  if (profiles.length === 0) return false;
  return profiles.every((profile) => profile.id === id);
}

/**
 * True when `id` is safe to interpolate into a filename.
 *
 * `profileStatePath` builds `profiles/<id>.json` from an id that arrives from
 * the renderer on every profile call, and it was the one renderer-supplied
 * string in the app that became a path without passing a containment check.
 * A `..` or a separator turned "load this profile" into an arbitrary JSON
 * read, "save" into an arbitrary write, and "delete" into an arbitrary unlink.
 *
 * An allowlist rather than a traversal check, because an id is a single
 * filename component: anything that is not one is wrong wherever it would land,
 * and this needs no path resolution to be correct. It also rules out the
 * Windows-specific ways a name stops being a name — a drive letter, a colon, a
 * trailing dot or space.
 *
 * Every id the app has ever minted comes from `randomUUID()`, which is
 * hyphenated hex, so nothing legitimate is turned away.
 */
export function isSafeProfileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
