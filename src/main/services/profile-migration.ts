import type { ProfileState } from '@shared/types';

/**
 * Forward migration for per-profile state.
 *
 * Watch history and poster choices cannot be regenerated from anything, so a
 * version this build does not recognise must never be quietly replaced with an
 * empty profile. The previous behaviour — `schemaVersion !== CURRENT` returns
 * an empty state — would have wiped every user's history the first time the
 * schema was bumped after a release.
 *
 * Rules:
 *   - no file            → fresh empty state (a genuinely new profile)
 *   - older version      → migrate forward, step by step
 *   - current version    → load as-is
 *   - newer version      → throw; a downgraded app must not truncate data it
 *                          does not understand
 */

export const PROFILE_SCHEMA_VERSION = 1;

export class ProfileSchemaError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(
      `Profile data is version ${found}, but this build understands up to ` +
        `${supported}. Refusing to load it rather than discard watch history — ` +
        `update the app, or restore an older profile file.`
    );
    this.name = 'ProfileSchemaError';
  }
}

/**
 * One step per schema bump, keyed by the version it upgrades *from*.
 * Empty today; the point is that adding version 2 means adding `1: …` here
 * rather than editing the loader and hoping nothing resets.
 */
const STEPS: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {};

export function emptyProfileState(profileId: string): ProfileState {
  return { schemaVersion: PROFILE_SCHEMA_VERSION, profileId, watch: {}, posterChoice: {} };
}

/**
 * Reads the declared version. Files written before versioning existed have the
 * right shape but no marker, so a recognisable body counts as version 1.
 */
function versionOf(raw: Record<string, unknown>): number {
  const declared = raw['schemaVersion'];
  if (typeof declared === 'number' && Number.isInteger(declared)) return declared;
  return 'watch' in raw || 'posterChoice' in raw ? 1 : 0;
}

export function migrateProfileState(raw: unknown, profileId: string): ProfileState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyProfileState(profileId);
  }

  let state = { ...(raw as Record<string, unknown>) };
  const found = versionOf(state);

  if (found > PROFILE_SCHEMA_VERSION) throw new ProfileSchemaError(found, PROFILE_SCHEMA_VERSION);

  for (let version = Math.max(found, 1); version < PROFILE_SCHEMA_VERSION; version += 1) {
    const step = STEPS[version];
    if (!step) throw new ProfileSchemaError(found, PROFILE_SCHEMA_VERSION);
    state = step(state);
  }

  // Fill gaps rather than reject: a missing map is recoverable, and losing the
  // other map alongside it would not be.
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileId,
    watch: isRecord(state['watch']) ? (state['watch'] as ProfileState['watch']) : {},
    posterChoice: isRecord(state['posterChoice'])
      ? (state['posterChoice'] as ProfileState['posterChoice'])
      : {}
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
