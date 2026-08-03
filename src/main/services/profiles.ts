import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { MAX_PROFILES } from '@shared/constants';
import type { Profile, ProfileState, WatchEntry } from '@shared/types';
import { readJsonOrFail, writeJsonAtomic } from './atomic-json.js';
import { userDataDir } from './config.js';
import { emptyProfileState, migrateProfileState } from './profile-migration.js';

/**
 * Profiles and their watch state.
 *
 * This is the only data in the app that cannot be rebuilt from disk or a
 * re-scrape, so every write goes through `writeJsonAtomic` and each profile
 * lives in its own file — one corrupt profile can never take the others down.
 */

/** Avatar accents, handed out in order as profiles are created. */
const ACCENTS = ['#a78bfa', '#f472b6', '#4ade80', '#60a5fa', '#fbbf24'] as const;

export class ProfileLimitError extends Error {
  constructor() {
    super(`You can have at most ${MAX_PROFILES} profiles.`);
    this.name = 'ProfileLimitError';
  }
}

export function profilesPath(): string {
  return join(userDataDir(), 'profiles.json');
}

export function profileStatePath(id: string): string {
  return join(userDataDir(), 'profiles', `${id}.json`);
}

export async function loadProfiles(): Promise<Profile[]> {
  // Throws if the file exists but is unreadable — returning [] there would let
  // ensureProfile() create a duplicate and orphan the real one.
  const list = await readJsonOrFail<Profile[]>(profilesPath(), []);
  return Array.isArray(list) ? list : [];
}

async function saveProfiles(profiles: Profile[]): Promise<void> {
  await writeJsonAtomic(profilesPath(), profiles);
}

function nextAccent(existing: Profile[]): string {
  const used = new Set(existing.map((p) => p.accent));
  return ACCENTS.find((accent) => !used.has(accent)) ?? ACCENTS[existing.length % ACCENTS.length]!;
}

export async function createProfile(name: string): Promise<Profile> {
  const profiles = await loadProfiles();
  if (profiles.length >= MAX_PROFILES) throw new ProfileLimitError();

  const trimmed = name.trim() || `Profile ${profiles.length + 1}`;
  const profile: Profile = {
    id: randomUUID(),
    name: trimmed,
    accent: nextAccent(profiles),
    createdAt: new Date().toISOString()
  };

  await saveProfiles([...profiles, profile]);
  await saveProfileState(emptyProfileState(profile.id));
  return profile;
}

/** Deletes the profile and its watch history. Irreversible by design. */
export async function deleteProfile(id: string): Promise<Profile[]> {
  const remaining = (await loadProfiles()).filter((p) => p.id !== id);
  await saveProfiles(remaining);
  await rm(profileStatePath(id), { force: true });
  return remaining;
}

export async function renameProfile(id: string, name: string): Promise<Profile[]> {
  const profiles = await loadProfiles();
  const trimmed = name.trim();
  if (!trimmed) return profiles;

  const updated = profiles.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
  await saveProfiles(updated);
  return updated;
}

/**
 * Guarantees at least one profile exists, so the UI never has to render an
 * empty profile menu on a fresh install.
 *
 * Serialised behind a shared promise: React StrictMode double-invokes effects,
 * so two `listProfiles()` calls can land concurrently. Without this both see an
 * empty list, both create a profile, and the second write to profiles.json wins
 * while the first profile's state file is orphaned — taking any poster choices
 * or watch history written against it.
 */
let ensureInFlight: Promise<Profile[]> | null = null;

export async function ensureProfile(): Promise<Profile[]> {
  if (ensureInFlight) return ensureInFlight;

  ensureInFlight = (async () => {
    const profiles = await loadProfiles();
    if (profiles.length > 0) return profiles;
    await createProfile('Me');
    return loadProfiles();
  })();

  try {
    return await ensureInFlight;
  } finally {
    ensureInFlight = null;
  }
}

/**
 * Throws on data written by a newer build rather than resetting it — see
 * `profile-migration.ts`. Callers that write back must let that propagate.
 */
export async function loadProfileState(id: string): Promise<ProfileState> {
  const loaded = await readJsonOrFail<unknown>(profileStatePath(id), null);
  return migrateProfileState(loaded, id);
}

export async function saveProfileState(state: ProfileState): Promise<void> {
  await writeJsonAtomic(profileStatePath(state.profileId), state);
}

/**
 * Records playback position. Marks the film finished past 92% so it leaves the
 * Continue Watching deck without the user having to sit through the credits.
 */
export async function setWatchProgress(
  profileId: string,
  movieId: string,
  positionSec: number,
  durationSec: number
): Promise<ProfileState> {
  const state = await loadProfileState(profileId);
  const safeDuration = Math.max(0, durationSec);
  const safePosition = Math.min(Math.max(0, positionSec), safeDuration || Number.MAX_SAFE_INTEGER);

  const entry: WatchEntry = {
    movieId,
    positionSec: safePosition,
    durationSec: safeDuration,
    updatedAt: new Date().toISOString(),
    finished: safeDuration > 0 && safePosition / safeDuration >= 0.92
  };

  const next: ProfileState = { ...state, watch: { ...state.watch, [movieId]: entry } };
  await saveProfileState(next);
  return next;
}

export async function clearWatchProgress(
  profileId: string,
  movieId: string
): Promise<ProfileState> {
  const state = await loadProfileState(profileId);
  const watch = { ...state.watch };
  delete watch[movieId];

  const next: ProfileState = { ...state, watch };
  await saveProfileState(next);
  return next;
}

/** Remembers which of the cached posters this profile prefers for a film. */
export async function setPosterChoice(
  profileId: string,
  movieId: string,
  index: number
): Promise<ProfileState> {
  const state = await loadProfileState(profileId);
  const next: ProfileState = {
    ...state,
    posterChoice: { ...state.posterChoice, [movieId]: Math.max(0, index) }
  };
  await saveProfileState(next);
  return next;
}
