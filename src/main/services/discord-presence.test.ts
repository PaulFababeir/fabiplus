import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { describe, it } from 'node:test';

import {
  DiscordPresence,
  buildActivity,
  decodeFrames,
  encodeFrame,
  pipePath
} from './discord-presence.js';

describe('encodeFrame', () => {
  it('prefixes opcode and byte length as little-endian int32', () => {
    const frame = encodeFrame(1, { a: 1 });
    const json = JSON.stringify({ a: 1 });

    assert.equal(frame.readInt32LE(0), 1);
    assert.equal(frame.readInt32LE(4), Buffer.byteLength(json));
    assert.equal(frame.subarray(8).toString('utf8'), json);
  });

  /** Length is bytes, not characters — a title with accents would desync. */
  it('measures length in bytes, not characters', () => {
    const frame = encodeFrame(1, { t: 'Amélie ソラニン' });
    const body = frame.subarray(8);
    assert.equal(frame.readInt32LE(4), body.length);
    assert.deepEqual(JSON.parse(body.toString('utf8')), { t: 'Amélie ソラニン' });
  });
});

describe('pipePath', () => {
  it('uses the Windows named-pipe form', () => {
    if (process.platform !== 'win32') return;
    assert.equal(pipePath(0), '\\\\?\\pipe\\discord-ipc-0');
    assert.equal(pipePath(3), '\\\\?\\pipe\\discord-ipc-3');
  });
});

describe('buildActivity', () => {
  const base = {
    name: null,
    type: 0,
    details: 'Interstellar',
    state: '2014',
    remainingSec: null,
    largeImage: null
  };

  it('maps details and state to the lines below the first', () => {
    const payload = buildActivity(base);
    assert.equal(payload['details'], 'Interstellar');
    assert.equal(payload['state'], '2014');
  });

  /** Omitted, not nulled — that is what makes Discord use the app name. */
  it('omits name entirely when there is none', () => {
    assert.equal('name' in buildActivity(base), false);
  });

  it('sends a name to replace the application name on the first line', () => {
    assert.equal(buildActivity({ ...base, name: 'Interstellar' })['name'], 'Interstellar');
  });

  /** 3 is Watching; the desktop client honours it over the local socket. */
  it('carries the activity type through', () => {
    assert.equal(buildActivity({ ...base, type: 3 })['type'], 3);
  });

  /** `end` is what makes Discord render a countdown rather than elapsed time. */
  it('sends an end timestamp so Discord shows time remaining', () => {
    const payload = buildActivity({ ...base, remainingSec: 600 });
    const stamps = payload['timestamps'] as { end: number };
    const expected = Date.now() + 600_000;
    assert.ok(Math.abs(stamps.end - expected) < 2000, `got ${stamps.end}`);
  });

  it('omits timestamps when the runtime is unknown', () => {
    assert.equal(buildActivity(base)['timestamps'], undefined);
    assert.equal(buildActivity({ ...base, remainingSec: 0 })['timestamps'], undefined);
  });

  it('omits an empty state rather than sending a blank line', () => {
    assert.equal(buildActivity({ ...base, state: '' })['state'], undefined);
  });

  it('only sends assets when an image key is configured', () => {
    assert.equal(buildActivity(base)['assets'], undefined);
    assert.deepEqual(buildActivity({ ...base, largeImage: 'poster' })['assets'], {
      large_image: 'poster',
      large_text: 'Interstellar'
    });
  });

  /** The hover label should name the film, not its year and genre. */
  it('labels the artwork with the name when there is one', () => {
    const payload = buildActivity({
      ...base,
      name: 'Solanin',
      details: '2010 · Drama',
      largeImage: 'poster'
    });
    assert.deepEqual(payload['assets'], { large_image: 'poster', large_text: 'Solanin' });
  });
});

describe('decodeFrames', () => {
  it('reads a single frame', () => {
    const { frames, rest } = decodeFrames(encodeFrame(1, { evt: 'READY' }));
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.opcode, 1);
    assert.deepEqual(frames[0]?.payload, { evt: 'READY' });
    assert.equal(rest.length, 0);
  });

  it('reads several frames from one chunk', () => {
    const buf = Buffer.concat([encodeFrame(1, { a: 1 }), encodeFrame(3, { b: 2 })]);
    const { frames, rest } = decodeFrames(buf);
    assert.equal(frames.length, 2);
    assert.equal(frames[1]?.opcode, 3);
    assert.equal(rest.length, 0);
  });

  /**
   * A pipe read is not frame-aligned. Dropping the tail here would lose the
   * READY event and leave the presence stuck on a default activity.
   */
  it('carries a partial frame forward', () => {
    const whole = encodeFrame(1, { evt: 'READY' });
    const first = decodeFrames(whole.subarray(0, 10));
    assert.equal(first.frames.length, 0);
    assert.equal(first.rest.length, 10);

    const second = decodeFrames(Buffer.concat([first.rest, whole.subarray(10)]));
    assert.equal(second.frames.length, 1);
    assert.deepEqual(second.frames[0]?.payload, { evt: 'READY' });
  });

  it('holds a header split across chunks', () => {
    const whole = encodeFrame(1, { evt: 'READY' });
    const { frames, rest } = decodeFrames(whole.subarray(0, 5));
    assert.equal(frames.length, 0);
    assert.equal(rest.length, 5);
  });

  it('skips an unparseable body without losing later frames', () => {
    const bad = Buffer.alloc(8);
    bad.writeInt32LE(1, 0);
    bad.writeInt32LE(3, 4);
    const buf = Buffer.concat([bad, Buffer.from('not', 'utf8'), encodeFrame(1, { ok: true })]);

    const { frames } = decodeFrames(buf);
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0]?.payload, { ok: true });
  });

  it('round-trips multibyte payloads', () => {
    const { frames } = decodeFrames(encodeFrame(1, { t: 'ソラニン' }));
    assert.deepEqual(frames[0]?.payload, { t: 'ソラニン' });
  });
});

/** What the stub reports as the application's name, as Discord would. */
const STUB_APP_NAME = 'Fabi+';

/**
 * A stand-in for the Discord client: answers a handshake with READY, records
 * the activities it is sent, and echoes each one back the way Discord does.
 * Runs on its own pipe so it never collides with a real Discord install on the
 * developer's machine.
 */
function stubDiscord(): Promise<{
  path: string;
  activities: (Record<string, unknown> | null)[];
  close: () => Promise<void>;
}> {
  const path =
    process.platform === 'win32'
      ? `\\\\?\\pipe\\movie-app-test-${randomUUID()}`
      : `${process.env['TMPDIR'] ?? '/tmp'}/movie-app-test-${randomUUID()}`;

  const activities: (Record<string, unknown> | null)[] = [];
  const sockets: Socket[] = [];

  const server: Server = createServer((socket) => {
    sockets.push(socket);
    // Annotated: `Buffer.alloc` is the narrower Buffer<ArrayBuffer>, but the
    // remainder handed back by decodeFrames is a plain Buffer.
    let buffer: Buffer = Buffer.alloc(0);

    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => {
      const decoded = decodeFrames(Buffer.concat([buffer, chunk]));
      buffer = decoded.rest;

      for (const frame of decoded.frames) {
        if (frame.opcode === 0) {
          socket.write(encodeFrame(1, { cmd: 'DISPATCH', evt: 'READY', data: {} }));
          continue;
        }
        if (frame.opcode === 1 && frame.payload['cmd'] === 'SET_ACTIVITY') {
          const args = frame.payload['args'] as { activity: Record<string, unknown> | null };
          activities.push(args.activity);

          // Discord echoes the applied activity back, filling `name` in from
          // the application whenever the caller did not supply one.
          socket.write(
            encodeFrame(1, {
              cmd: 'SET_ACTIVITY',
              evt: null,
              data: { ...args.activity, name: args.activity?.['name'] ?? STUB_APP_NAME }
            })
          );
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(path, () =>
      resolve({
        path,
        activities,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          })
      })
    );
  });
}

const solanin = {
  name: 'Solanin',
  type: 3,
  details: '2010',
  state: '',
  remainingSec: null,
  largeImage: null
};

/**
 * Tears the stub and socket down even when an assertion throws — otherwise a
 * failing test leaves a live pipe server and the whole run hangs instead of
 * reporting the failure.
 */
async function withStub(
  run: (
    discord: Awaited<ReturnType<typeof stubDiscord>>,
    presence: DiscordPresence
  ) => Promise<void>
): Promise<void> {
  const discord = await stubDiscord();
  const presence = new DiscordPresence(() => discord.path);
  try {
    await run(discord, presence);
  } finally {
    presence.disconnect();
    await discord.close();
  }
}

describe('DiscordPresence', () => {
  it('sends the activity once connected', async () => {
    await withStub(async (discord, presence) => {
      assert.equal(await presence.connect('app-id'), true);
      presence.set(solanin);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(discord.activities.length, 1);
      assert.equal(discord.activities[0]?.['name'], 'Solanin');
    });
  });

  /**
   * The bug this guards: two calls in the same tick each opened a socket and
   * each overwrote the single READY-resolver slot. The orphaned first attempt
   * timed out four seconds later and disconnected, killing the live connection
   * its successor was using — presence appeared, then vanished. The player
   * produces exactly this pattern on mount.
   */
  it('survives concurrent connects', async () => {
    await withStub(async (_discord, presence) => {
      const [a, b] = await Promise.all([presence.connect('app-id'), presence.connect('app-id')]);
      assert.equal(a, true);
      assert.equal(b, true);

      presence.set(solanin);

      // Well past the READY timeout an orphaned attempt would have fired at.
      await new Promise((r) => setTimeout(r, 4500));
      assert.equal(presence.connected, true, 'a stale attempt tore down the connection');
    });
  });

  it('reuses the connection instead of reconnecting', async () => {
    await withStub(async (_discord, presence) => {
      await presence.connect('app-id');
      assert.equal(await presence.connect('app-id'), true);
      assert.equal(presence.connected, true);
    });
  });

  /**
   * The application's name lives in the developer portal, not in this codebase,
   * so the only way to learn it is to read what Discord fills in when we send
   * no override. The browsing activity does that, and goes out first.
   */
  it('learns the application name from an activity with no override', async () => {
    await withStub(async (_discord, presence) => {
      await presence.connect('app-id');
      assert.equal(presence.appName, null);

      presence.set({ ...solanin, name: null });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(presence.appName, STUB_APP_NAME);
    });
  });

  it('does not mistake an echo of its own override for the app name', async () => {
    await withStub(async (_discord, presence) => {
      await presence.connect('app-id');

      presence.set(solanin);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(presence.appName, null, 'took the film title for the app name');
    });
  });

  it('keeps the learned name once a film starts overriding it', async () => {
    await withStub(async (_discord, presence) => {
      await presence.connect('app-id');

      presence.set({ ...solanin, name: null });
      await new Promise((r) => setTimeout(r, 50));

      presence.set(solanin);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(presence.appName, STUB_APP_NAME);
    });
  });

  it('reports failure when nothing is listening', async () => {
    const presence = new DiscordPresence(
      (i) => `${pipePath(i)}-movie-app-absent-${randomUUID()}`
    );
    assert.equal(await presence.connect('app-id'), false);
  });
});
