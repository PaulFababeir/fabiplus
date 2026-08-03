/**
 * Dev tool: connects to Discord over IPC and reports every step, so a failure
 * can be attributed to the pipe, the handshake, or the activity payload.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/discord-probe.ts <appId>
 */
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';

import { buildActivity, decodeFrames, encodeFrame, pipePath } from '../src/main/services/discord-presence.js';

const appId = process.argv[2];
if (!appId) {
  console.error('usage: discord-probe.ts <applicationId>');
  process.exit(1);
}

const tryPipe = (path: string): Promise<ReturnType<typeof connect> | null> =>
  new Promise((resolve) => {
    const s = connect(path);
    s.once('connect', () => resolve(s));
    s.once('error', () => {
      s.destroy();
      resolve(null);
    });
  });

const main = async (): Promise<void> => {
  let socket = null;
  for (let i = 0; i < 10; i += 1) {
    socket = await tryPipe(pipePath(i));
    if (socket) {
      console.log(`connected on pipe ${i} (${pipePath(i)})`);
      break;
    }
  }
  if (!socket) {
    console.error('NO PIPE — Discord desktop is not reachable');
    process.exit(2);
  }

  let buffer: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const { frames, rest } = decodeFrames(Buffer.concat([buffer, chunk]));
    buffer = rest;
    for (const f of frames) {
      console.log(`<- op=${f.opcode} ${JSON.stringify(f.payload).slice(0, 400)}`);

      if (f.payload['evt'] === 'READY') {
        const activity = buildActivity({
          name: 'Interstellar',
          type: 3,
          details: '2014 · Adventure',
          state: '',
          remainingSec: 5400,
          largeImage: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg'
        });
        console.log('-> SET_ACTIVITY', JSON.stringify(activity));
        socket!.write(
          encodeFrame(1, {
            cmd: 'SET_ACTIVITY',
            args: { pid: process.pid, activity },
            nonce: randomUUID()
          })
        );
      }
    }
  });

  console.log(`-> HANDSHAKE client_id=${appId}`);
  socket.write(encodeFrame(0, { v: 1, client_id: appId }));

  setTimeout(() => {
    console.log('--- holding presence 12s, check your profile ---');
  }, 1500);
  setTimeout(() => process.exit(0), 14000);
};

void main();
