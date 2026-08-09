import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AVATAR_EXTENSIONS,
  AVATAR_MAX_BYTES,
  avatarEncoding,
  storedExtension
} from './avatar-rules.js';

describe('avatarEncoding', () => {
  /**
   * The one with teeth. A decoder returns the first frame of an animated GIF,
   * so re-encoding turns a moving avatar into a still with no way to tell.
   */
  it('leaves a gif alone so it keeps animating', () => {
    assert.equal(avatarEncoding('.gif'), 'copy');
  });

  /** JPEG has no alpha; a cut-out avatar would gain a black background. */
  it('keeps png as png for the transparency', () => {
    assert.equal(avatarEncoding('.png'), 'png');
  });

  it('re-encodes photographs to jpeg', () => {
    for (const ext of ['.jpg', '.jpeg', '.webp', '.avif']) {
      assert.equal(avatarEncoding(ext), 'jpeg', ext);
    }
  });

  it('is case insensitive, as Windows paths are', () => {
    assert.equal(avatarEncoding('.GIF'), 'copy');
    assert.equal(avatarEncoding('.PNG'), 'png');
    assert.equal(avatarEncoding('.JPG'), 'jpeg');
  });
});

describe('storedExtension', () => {
  /** The stored name has to match the bytes, or `movie://` types it wrongly. */
  it('follows the encoding, not the source', () => {
    assert.equal(storedExtension('.webp', 'jpeg'), '.jpg');
    assert.equal(storedExtension('.jpeg', 'jpeg'), '.jpg');
    assert.equal(storedExtension('.png', 'png'), '.png');
  });

  it('keeps the original extension when the bytes are untouched', () => {
    assert.equal(storedExtension('.gif', 'copy'), '.gif');
    assert.equal(storedExtension('.AVIF', 'copy'), '.avif');
  });
});

describe('avatar limits', () => {
  it('accepts an ordinary phone photo', () => {
    assert.ok(AVATAR_MAX_BYTES >= 12 * 1024 * 1024);
  });

  /** Every accepted extension must be one `media-server.ts` can type. */
  it('offers only formats the app can serve back', () => {
    assert.deepEqual(
      [...AVATAR_EXTENSIONS].sort(),
      ['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']
    );
  });
});
