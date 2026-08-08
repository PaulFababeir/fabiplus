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
