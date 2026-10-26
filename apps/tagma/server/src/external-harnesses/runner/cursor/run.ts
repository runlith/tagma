import { join } from 'node:path';
import { Effect, FileSystem, Stream } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import type { Invocation } from '../../../platform/cli/verb.js';
import type { ServerCli } from '../../cli/server.js';
import { hostedAgent } from '../hosted/agent.js';
import { ServerDoor } from '../hosted/door.js';
import { serveHosted } from '../hosted/run.js';
import { CursorSdk } from './channel.js';
import { makeCursorCycle, type Launch } from './cycle.js';
import { cursorSdk } from './sdk.js';

export const runCursor = Effect.fnUntraced(function* (server: ServerCli, at: Invocation, launch: Launch) {
  const directory = at.env.CURSOR_DATA_DIR;
  const apiKey = at.env.CURSOR_API_KEY;
  if (!directory) return yield* new AgentFault({ code: FAULT.internal, message: 'The Cursor runner has no thread storage directory.' });
  if (!apiKey) return yield* new AgentFault({ code: FAULT.authRequired, message: 'Sign in to Cursor on the Providers screen.' });
  const files = yield* FileSystem.FileSystem;
  const home = join(directory, 'home');
  const temporary = join(directory, 'tmp');
  yield* files.makeDirectory(home, { recursive: true }).pipe(Effect.orDie);
  yield* files.makeDirectory(temporary, { recursive: true }).pipe(Effect.orDie);
  process.env.CURSOR_DATA_DIR = directory;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TMPDIR = temporary;
  process.env.TEMP = temporary;
  process.env.TMP = temporary;
  const sdk = cursorSdk(yield* Effect.promise(() => import('@cursor/sdk')));
  const door = new ServerDoor(server, at);
  const input = Stream.fromReadableStream({
    evaluate: at.stdin,
    onError: (cause) => new ExchangeFailed({ detail: `stdin failed: ${String(cause)}` }),
  });
  const out = Bun.stdout.writer();
  const write = (bytes: Uint8Array) =>
    Effect.try({
      try: () => {
        out.write(bytes);
        out.flush();
      },
      catch: (cause) => new ExchangeFailed({ detail: `stdout failed: ${String(cause)}` }),
    });
  yield* serveHosted(
    input,
    write,
    (process) => Effect.map(makeCursorCycle(door, process, { directory, apiKey }, launch), (cycle) => hostedAgent(cycle, door)),
    (text) => process.stderr.write(text),
  ).pipe(Effect.provideService(CursorSdk, sdk));
}, Effect.scoped);
