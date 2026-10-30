import type { AppConfig, RendererConfig } from '@shared/types';

/**
 * The config as it is allowed to reach the renderer.
 *
 * Every IPC handler that returns config goes through this. The renderer is
 * treated as untrusted, and the TMDB key was crossing to it on every
 * `config:get` — yet nothing on that side ever read the value, only whether
 * there was one. A secret the renderer never uses is a secret it can only
 * leak, so the field is removed rather than blanked: with no `tmdbApiKey` on
 * the type at all, renderer code cannot start depending on it either.
 *
 * Apart from `index.ts`, which imports `electron`, purely so a test can hold
 * the line — same split as `path-containment.ts`.
 */
export function toRendererConfig(config: AppConfig): RendererConfig {
  const { tmdbApiKey, ...rest } = config;
  return { ...rest, hasTmdbKey: tmdbApiKey !== null };
}
