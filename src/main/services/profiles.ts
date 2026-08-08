import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { MAX_PROFILES } from '@shared/constants';
import type { Profile, ProfileState, WatchEntry } from '@shared/types';
import { readJsonOrFail, writeJsonAtomic } from './atomic-json.js';
import { avatarCacheDir, userDataDir } from './config.js';
import { emptyProfileState, migrateProfileState } from './profile-migration.js';
import { wouldEmptyProfiles } from './profile-rules.js';

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

export class LastProfileError extends Error {
  constructor() {
    super('The last profile cannot be deleted.');
    this.name = 'LastProfileError';
  }
}

export class AvatarTooLargeError extends Error {
  constructor() {
    super(`Pick an image under ${AVATAR_MAX_BYTES / 1024 / 1024} MB.`);
    this.name = 'AvatarTooLargeError';
  }
}

/**
 * The chip renders at 32px and nothing resizes the file on the way in, so a
 * 40-megapixel photo would be decoded in full every time the menu opens. The
 * dialog already filters to images; this is the guard against a large one.
 */
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

/** Extensions the renderer can actually display through `movie://`. */
const AVATAR_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

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
  if (!Array.isArray(list)) return [];

  // `avatarPath` postdates the first release, so records written before it
  // simply lack the key. Normalised on the way in rather than migrated: the
  // absence of an avatar is not a schema change, and profiles.json is the one
  // file worth touching as little as possible.
  return list.map((profile) => ({ ...profile, avatarPath: profile.avatarPath ?? null }));
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
    avatarPath: null,
    createdAt: new Date().toISOString()
  };

  await saveProfiles([...profiles, profile]);
  await saveProfileState(emptyProfileState(profile.id));
  return profile;
}

/**
 * Deletes the profile and its watch history. Irreversible by design.
 *
 * Refuses the last one. The app assumes a profile always exists, so an empty
 * `profiles.json` is not merely an odd state: `ensureProfile` creates a
 * replacement on the next launch and every watch record written against the old
 * id is orphaned. Hiding the button is not the guard — this is, because the
 * button is not the only caller.
 */
export async function deleteProfile(id: string): Promise<Profile[]> {
  const profiles = await loadProfiles();
  if (wouldEmptyProfiles(profiles, id)) throw new LastProfileError();

  const remaining = profiles.filter((p) => p.id !== id);
  await saveProfiles(remaining);
  await rm(profileStatePath(id), { force: true });

  // Otherwise the avatar outlives the profile as an orphan nothing references.
  const avatarPath = profiles.find((p) => p.id === id)?.avatarPath;
  if (avatarPath) await rm(avatarPath, { force: true });

  return remaining;
}

/**
 * Copies a chosen image into the app's own cache and points the profile at it.
 *
 * The copy is the point: a path into the user's photo library breaks the moment
 * that folder is tidied, and `movie://` refuses to serve anything outside the
 * allowed roots anyway — of which the avatar cache is one and Pictures is not.
 *
 * The stored name carries a timestamp so replacing an avatar produces a new URL.
 * Reusing one would leave the renderer showing the previous image from cache
 * until the app restarted.
 */
export async function setProfileAvatar(id: string, sourcePath: string): Promise<Profile[]> {
  const extension = extname(sourcePath).toLowerCase();
  if (!AVATAR_EXTENSIONS.has(extension)) throw new Error('That file is not an image.');

  const info = await stat(sourcePath);
  if (info.size > AVATAR_MAX_BYTES) throw new AvatarTooLargeError();

  const profiles = await loadProfiles();
  const target = profiles.find((p) => p.id === id);
  if (!target) return profiles;

  await mkdir(avatarCacheDir(), { recursive: true });
  const destination = join(avatarCacheDir(), `${id}-${Date.now()}${extension}`);
  await copyFile(sourcePath, destination);

  // Only once the new one is safely in place.
  if (target.avatarPath) await rm(target.avatarPath, { force: true });

  const updated = profiles.map((p) => (p.id === id ? { ...p, avatarPath: destination } : p));
  await saveProfiles(updated);
  return updated;
}

/** Drops back to the accent chip, deleting the copied file. */
export async function clearProfileAvatar(id: string): Promise<Profile[]> {
  const profiles = await loadProfiles();
  const target = profiles.find((p) => p.id === id);
  if (!target?.avatarPath) return profiles;

  await rm(target.avatarPath, { force: true });
  const updated = profiles.map((p) => (p.id === id ? { ...p, avatarPath: null } : p));
  await saveProfiles(updated);
  return updated;
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

/**
 * Marks a film watched by hand, or returns it to the deck.
 *
 * Deliberately not `clearWatchProgress`. Clearing forgets the entry, so the
 * film comes straight back the next time it is played; marking it finished is a
 * statement about the film that outlives the position, and can be undone.
 *
 * A film with no entry can still be marked — that is the ordinary case for
 * something watched elsewhere — so one is created at full duration rather than
 * silently doing nothing.
 */
export async function setWatchFinished(
  profileId: string,
  movieId: string,
  finished: boolean
): Promise<ProfileState> {
  const state = await loadProfileState(profileId);
  const existing = state.watch[movieId];

  const entry: WatchEntry = existing
    ? { ...existing, finished, updatedAt: new Date().toISOString() }
    : {
        movieId,
        positionSec: 0,
        durationSec: 0,
        updatedAt: new Date().toISOString(),
        finished
      };

  const next: ProfileState = { ...state, watch: { ...state.watch, [movieId]: entry } };
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

/** The same, for the backdrop behind the sidebar. */
export async function setBackdropChoice(
  profileId: string,
  movieId: string,
  index: number
): Promise<ProfileState> {
  const state = await loadProfileState(profileId);
  const next: ProfileState = {
    ...state,
    backdropChoice: { ...state.backdropChoice, [movieId]: Math.max(0, index) }
  };
  await saveProfileState(next);
  return next;
}
