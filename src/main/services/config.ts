import { app } from 'electron';
import { join } from 'node:path';

import type { AppConfig } from '@shared/types';
import { readJsonSafe, writeJsonAtomic } from './atomic-json.js';

const SCHEMA_VERSION = 1;

/** %APPDATA%/movie-app on Windows. */
export function userDataDir(): string {
  return app.getPath('userData');
}

export function configPath(): string {
  return join(userDataDir(), 'config.json');
}

export function imageCacheDir(): string {
  return join(userDataDir(), 'cache', 'images');
}

export function libraryPath(): string {
  return join(userDataDir(), 'library.json');
}

function defaults(): AppConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    movieRoots: ['D:/Movies'],
    seriesRoots: [],
    tmdbApiKey: null,
    lastProfileId: null,
    translucentBackground: true,
    videoBrightness: 1,
    discordPresence: false,
    discordAppId: null
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const loaded = await readJsonSafe<Partial<AppConfig> & { translucency?: string }>(
    configPath(),
    {}
  );

  // A short-lived build stored this as a level. Map it back rather than
  // resetting anyone's choice.
  const migrated: Partial<AppConfig> = { ...loaded };
  if (migrated.translucentBackground === undefined && typeof loaded.translucency === 'string') {
    migrated.translucentBackground = loaded.translucency !== 'off';
  }

  // Merge over defaults so a config written by an older build stays usable.
  return { ...defaults(), ...migrated, schemaVersion: SCHEMA_VERSION };
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  await writeJsonAtomic(configPath(), config);
  return config;
}
