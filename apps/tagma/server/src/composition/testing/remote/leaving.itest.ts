import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { RESTARTING_CLOSE } from '../../../platform/contract/wire/live.js';
import { Connections } from '../../../socket/connections.js';
import { remoteListener } from '../../http/remote.js';

const closedWith = Effect.fn('remoteFixture.shutdown')(function* (leaving: boolean) {
  const connections = new Connections();
  const codes: number[] = [];
  yield* connections.add('device', (code) => Effect.sync(() => void codes.push(code)));
  const listener = remoteListener(
    () => BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' }),
    connections,
    0,
    Effect.succeed(leaving),
  );
  yield* Effect.acquireRelease(listener.open, () => listener.close);
  return codes;
}, Effect.scoped);

it.live(
  'a paired-device door that closes while the server leaves for a restart ends its sockets with the restarting code, and with the going-away code otherwise',
  () =>
    Effect.gen(function* () {
      expect(yield* closedWith(true)).toEqual([RESTARTING_CLOSE]);
      expect(yield* closedWith(false)).toEqual([1001]);
    }),
);
