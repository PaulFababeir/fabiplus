/**
 * What to do with a picture the user chose as an avatar.
 *
 * Apart from `profiles.ts` because that module reaches `config.ts` for the file
 * paths, which imports `electron` — nothing importing it can be loaded by a
 * test. The decisions here are the part worth pinning down; the decoding itself
 * needs a real Electron runtime and lives beside the copy.
 */

/** Extensions the picker offers and `movie://` can serve back. */
export const AVATAR_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

/**
 * Ceiling on the file the user may pick.
 *
 * This is about what has to be decoded before it can be re-encoded, not about
 * disk — the stored copy is a few tens of KB whatever comes in.
 */
export const AVATAR_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Longest edge of the stored copy.
 *
 * The chip draws at 32px and the row tint spreads across roughly 230px, so 512
 * covers both at 2× device pixel ratio with room to spare. The point is that a
 * 4000px phone photo is never decoded again after the one time it is copied.
 */
export const AVATAR_MAX_EDGE = 512;

/** JPEG quality for the stored copy. Visually lossless at this scale. */
export const AVATAR_JPEG_QUALITY = 88;

export type AvatarEncoding = 'copy' | 'jpeg' | 'png';

/**
 * How the chosen file should be stored.
 *
 * `copy` means keep the bytes as they are. GIF is the case that matters: an
 * animated one has many frames and a decoder hands back only the first, so
 * re-encoding would silently flatten a moving avatar into a still.
 *
 * PNG stays PNG because it can carry transparency and JPEG cannot — an avatar
 * with a cut-out background would gain a black box. Everything else becomes
 * JPEG, which is far smaller for the photographs this is mostly used for.
 */
export function avatarEncoding(extension: string): AvatarEncoding {
  const ext = extension.toLowerCase();
  if (ext === '.gif') return 'copy';
  if (ext === '.png') return 'png';
  return 'jpeg';
}

/** The extension the stored copy must carry, given how it will be encoded. */
export function storedExtension(extension: string, encoding: AvatarEncoding): string {
  const ext = extension.toLowerCase();
  if (encoding === 'copy') return ext;
  return encoding === 'png' ? '.png' : '.jpg';
}
