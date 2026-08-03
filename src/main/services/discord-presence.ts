import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

import type { DiscordActivity } from '@shared/types';

/**
 * Discord Rich Presence over the local IPC socket.
 *
 * Written by hand rather than pulling in `discord-rpc`: the protocol is four
 * opcodes and a length-prefixed JSON frame, and the published clients are
 * either unmaintained or drag in an OAuth stack this needs none of.
 *
 * Nothing here talks to Discord's servers — it writes to a named pipe belonging
 * to the local Discord client, which does the publishing. If Discord is not
 * running the connection simply fails and presence stays off.
 *
 * Opt-in by design. This app is otherwise entirely private, and broadcasting
 * what someone is watching to everyone on their friends list is not a default
 * anyone should get by surprise.
 */

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

/** Discord exposes up to ten pipes; the first free one wins. */
const MAX_PIPES = 10;

/**
 * Length-prefixed frame: opcode and byte length as little-endian int32, then
 * the JSON payload. Pure, so the encoding is testable without a socket.
 */
export function encodeFrame(opcode: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

/** Windows names the pipes; other platforms use a socket under $TMPDIR. */
export function pipePath(index: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`;
  const base =
    process.env['XDG_RUNTIME_DIR'] ?? process.env['TMPDIR'] ?? process.env['TMP'] ?? '/tmp';
  return `${base.replace(/\/$/, '')}/discord-ipc-${index}`;
}

/**
 * Builds the activity payload.
 *
 * `timestamps.end` is what produces the Spotify-style countdown: Discord
 * derives "x left" from it, so the remaining runtime is sent rather than a
 * position that would need constant updates.
 */
export function buildActivity(activity: DiscordActivity): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    details: activity.title,
    state: activity.subtitle || undefined,
    instance: false
  };

  if (activity.remainingSec !== null && activity.remainingSec > 0) {
    payload['timestamps'] = { end: Date.now() + activity.remainingSec * 1000 };
  }

  if (activity.largeImage) {
    payload['assets'] = {
      large_image: activity.largeImage,
      large_text: activity.title
    };
  }

  return payload;
}

class DiscordPresence {
  #socket: Socket | null = null;
  #ready = false;
  #appId: string | null = null;
  /** Held while disconnected so it can be sent as soon as a pipe opens. */
  #pending: DiscordActivity | null = null;

  get connected(): boolean {
    return this.#ready;
  }

  async connect(appId: string): Promise<boolean> {
    if (this.#ready && this.#appId === appId) return true;
    this.disconnect();
    this.#appId = appId;

    for (let i = 0; i < MAX_PIPES; i += 1) {
      const socket = await tryPipe(pipePath(i));
      if (!socket) continue;

      this.#socket = socket;
      socket.on('error', () => this.disconnect());
      socket.on('close', () => {
        this.#ready = false;
        this.#socket = null;
      });

      socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: appId }));
      this.#ready = true;

      if (this.#pending) this.set(this.#pending);
      return true;
    }
    return false;
  }

  set(activity: DiscordActivity | null): void {
    this.#pending = activity;
    if (!this.#ready || !this.#socket) return;

    this.#socket.write(
      encodeFrame(OP_FRAME, {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: process.pid,
          // null clears the presence rather than leaving a stale film up.
          activity: activity ? buildActivity(activity) : null
        },
        nonce: randomUUID()
      })
    );
  }

  disconnect(): void {
    if (this.#socket) {
      try {
        this.#socket.write(encodeFrame(OP_CLOSE, {}));
        this.#socket.destroy();
      } catch {
        // Already gone; nothing to clean up.
      }
    }
    this.#socket = null;
    this.#ready = false;
  }
}

function tryPipe(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (result: Socket | null): void => {
      socket.removeAllListeners('connect');
      socket.removeAllListeners('error');
      if (!result) socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(socket));
    socket.once('error', () => done(null));
  });
}

export const presence = new DiscordPresence();
