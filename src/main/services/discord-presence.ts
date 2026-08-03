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
const OP_PING = 3;
const OP_PONG = 4;

/** Give up waiting for READY rather than hanging if Discord never answers. */
const READY_TIMEOUT_MS = 4000;

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

export interface DecodedFrame {
  opcode: number;
  payload: Record<string, unknown>;
}

/**
 * Splits a stream into frames, returning whatever is left over.
 *
 * A pipe read is not frame-aligned: one chunk can carry several frames or half
 * of one, so the remainder has to be carried forward. Pure, so that boundary
 * handling is testable without a socket.
 */
export function decodeFrames(buffer: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = [];
  let offset = 0;

  while (buffer.length - offset >= 8) {
    const opcode = buffer.readInt32LE(offset);
    const length = buffer.readInt32LE(offset + 4);
    if (length < 0 || buffer.length - offset - 8 < length) break;

    const body = buffer.subarray(offset + 8, offset + 8 + length).toString('utf8');
    offset += 8 + length;

    try {
      frames.push({ opcode, payload: JSON.parse(body) as Record<string, unknown> });
    } catch {
      // A frame we cannot parse is not worth tearing the connection down for.
    }
  }

  return { frames, rest: buffer.subarray(offset) };
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

export class DiscordPresence {
  #socket: Socket | null = null;
  #ready = false;
  #appId: string | null = null;
  /** Held until READY arrives, then sent. */
  #pending: DiscordActivity | null = null;
  #buffer: Buffer = Buffer.alloc(0);
  #onReady: (() => void) | null = null;
  /** Shared by callers that arrive while a connection is still opening. */
  #connecting: Promise<boolean> | null = null;
  /** Bumped per attempt so a superseded one cannot tear down its successor. */
  #generation = 0;

  /** Overridable so tests can point at a stub pipe instead of Discord's. */
  #resolvePipe: (index: number) => string;

  constructor(resolvePipe: (index: number) => string = pipePath) {
    this.#resolvePipe = resolvePipe;
  }

  get connected(): boolean {
    return this.#ready;
  }

  /**
   * Concurrent callers share one attempt.
   *
   * Without this, two calls in the same tick each opened a socket and each
   * wrote their resolver into `#onReady`, so the second silently orphaned the
   * first. The orphan then timed out and disconnected — killing the live
   * connection its successor was using, a few seconds after presence appeared.
   * The player triggers exactly that: its effect and cleanup both fire, and
   * StrictMode double-invokes them on mount.
   */
  async connect(appId: string): Promise<boolean> {
    if (this.#ready && this.#appId === appId) return true;
    if (this.#connecting && this.#appId === appId) return this.#connecting;

    this.disconnect();
    this.#appId = appId;

    const attempt = (this.#generation += 1);
    this.#connecting = this.#open(appId, attempt).finally(() => {
      if (this.#generation === attempt) this.#connecting = null;
    });
    return this.#connecting;
  }

  async #open(appId: string, attempt: number): Promise<boolean> {
    for (let i = 0; i < MAX_PIPES; i += 1) {
      const socket = await tryPipe(this.#resolvePipe(i));
      if (!socket) continue;

      // A newer attempt took over while this pipe was opening.
      if (this.#generation !== attempt) {
        socket.destroy();
        return false;
      }

      this.#socket = socket;
      this.#buffer = Buffer.alloc(0);
      socket.on('error', () => this.disconnect());
      socket.on('close', () => {
        this.#ready = false;
        this.#socket = null;
      });
      socket.on('data', (chunk: Buffer) => this.#read(chunk));

      socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: appId }));

      // Frames sent before Discord dispatches READY are discarded, which is
      // why the presence showed the app with a default elapsed timer and none
      // of the title or artwork that had already been written.
      if (await this.#awaitReady()) return true;
      if (this.#generation === attempt) this.disconnect();
      return false;
    }
    return false;
  }

  #awaitReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#onReady = null;
        resolve(false);
      }, READY_TIMEOUT_MS);

      this.#onReady = () => {
        clearTimeout(timer);
        this.#onReady = null;
        resolve(true);
      };
    });
  }

  #read(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const { frames, rest } = decodeFrames(this.#buffer);
    this.#buffer = rest;

    for (const frame of frames) {
      if (frame.opcode === OP_PING) {
        this.#socket?.write(encodeFrame(OP_PONG, frame.payload));
        continue;
      }
      if (frame.opcode === OP_CLOSE) {
        this.disconnect();
        continue;
      }
      if (frame.opcode === OP_FRAME && frame.payload['evt'] === 'READY') {
        this.#ready = true;
        this.#onReady?.();
        // Whatever was queued while connecting goes out now that it will stick.
        if (this.#pending) this.set(this.#pending);
      }
    }
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
    this.#buffer = Buffer.alloc(0);
    this.#onReady = null;
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
