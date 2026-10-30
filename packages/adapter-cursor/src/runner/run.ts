import { join } from 'node:path';
import { Effect, FileSystem, Stdio, Stream } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunStdio from '@effect/platform-bun/BunStdio';
import { cursorSelection } from '../selection.js';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { serveHosted, type HostedAsk, type HostedLaunch, type HostedRunner, type Invoked } from '@runlith/hosted-runner/run';
import { CursorSdk } from './channel.js';
import { makeCursorCycle } from './cycle.js';
import { cursorSdk } from './sdk.js';

const prepareHome = Effect.fn('cursor.prepareHome')(function* (directory: string) {
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
});

const runCursor = Effect.fnUntraced(function* (at: Invoked, door: HostedDoor, launch: HostedLaunch) {
  const directory = at.env.CURSOR_DATA_DIR;
  const apiKey = at.env.CURSOR_API_KEY;
  if (!directory) return yield* new AgentFault({ code: FAULT.internal, message: 'The Cursor runner has no thread storage directory.' });
  if (!apiKey) return yield* new AgentFault({ code: FAULT.authRequired, message: 'Sign in to Cursor on the Providers screen.' });
  yield* prepareHome(directory);
  const sdk = cursorSdk(yield* Effect.promise(() => import('@cursor/sdk')));
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
    (process) =>
      Effect.map(makeCursorCycle(door, process, { directory, apiKey }, { ...launch, parameters: {} }), (cycle) => hostedAgent(cycle, door)),
    (text) => process.stderr.write(text),
  ).pipe(Effect.provideService(CursorSdk, sdk));
}, Effect.scoped);

const runAsk = Effect.fn('cursor.runAsk')(function* (at: Invoked, { model, effort, system }: HostedAsk) {
  const apiKey = at.env.CURSOR_API_KEY;
  if (!apiKey) return yield* new AgentFault({ code: FAULT.authRequired, message: 'unauthenticated: Cursor API key is missing.' });
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ directory: at.cwd, prefix: 'tagma-cursor-ask-' });
  yield* prepareHome(directory);
  const cwd = join(directory, 'work');
  yield* files.makeDirectory(cwd);
  const decoder = new TextDecoder();
  const input = yield* Stream.fromReadableStream({
    evaluate: at.stdin,
    onError: (cause) => new ExchangeFailed({ detail: `stdin failed: ${String(cause)}` }),
  }).pipe(
    Stream.runFold(
      () => new Array<string>(),
      (parts, bytes) => {
        parts.push(decoder.decode(bytes, { stream: true }));
        return parts;
      },
    ),
    Effect.map((parts) => parts.join('') + decoder.decode()),
  );
  const sdk = yield* Effect.promise(() => import('@cursor/sdk'));
  const failed = (cause: unknown) =>
    new AgentFault({
      code: FAULT.internal,
      message: cause instanceof sdk.CursorSdkError ? `${cause.code ?? cause.name}: ${cause.message}` : String(cause),
    });
  const agent = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        sdk.Agent.create({
          apiKey,
          model: cursorSelection(model, effort),
          tools: [],
          mode: 'agent',
          local: {
            cwd,
            store: new sdk.JsonlLocalAgentStore(join(directory, 'store')),
            settingSources: [],
            autoReview: false,
            sandboxOptions: { enabled: false },
            customTools: {},
          },
        }),
      catch: failed,
    }),
    (agent) => Effect.sync(() => agent.close()),
  );
  const run = yield* Effect.tryPromise({ try: () => agent.send(`${system}\n\n${input}`), catch: failed });
  const result = yield* Effect.tryPromise({ try: () => run.wait(), catch: failed });
  if (result.status !== 'finished')
    return yield* new AgentFault({
      code: FAULT.internal,
      message: `${result.error?.code ?? result.status}: ${result.error?.message ?? 'Cursor did not finish the ask.'}`,
    });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.run(Stream.make(`${JSON.stringify({ text: result.result, usage: result.usage })}\n`), stdio.stdout());
}, Effect.scoped);

export const cursorRunner: HostedRunner = {
  run: (at, door, launch) => runCursor(at, door, launch).pipe(Effect.provide(BunFileSystem.layer)),
  ask: (at, ask) => runAsk(at, ask).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(BunStdio.layer)),
  cut: null,
};
