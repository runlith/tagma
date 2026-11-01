import { join } from 'node:path';
import { Deferred, Effect, FileSystem, Result, Schema, Stdio, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunStdio from '@effect/platform-bun/BunStdio';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { hostedStdio, serveHosted, type HostedAsk, type HostedLaunch, type HostedRunner, type Invoked } from '@runlith/hosted-runner/run';
import { HARNESS_PROGRAM } from '@runlith/hosted-runner/wire/program';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import { MUSE_CODE_STORAGE } from '../harness/acp.js';
import { MuseSdk, type Frame } from './channel.js';
import { serveMcpOverHttp } from '@runlith/mcp/server';
import { makeMuseCycle, type MuseRunner } from './cycle.js';
import { LOGIN, spentOf } from './feed.js';
import { ItemEvent, TokenUsage, TurnCompleted, type Tokens } from './frames.js';
import { prepareHome, writeSettings, type MusePlace } from './home.js';
import { loadMuseSdk } from './sdk.js';

const programOf = (env: Readonly<Record<string, string | undefined>>) => {
  const found = env[HARNESS_PROGRAM] ?? Bun.which('muse', { PATH: env.PATH ?? '' });
  return found === null
    ? Effect.fail(new AgentFault({ code: FAULT.internal, message: "muse is not installed on this machine's PATH; install Muse Code" }))
    : Effect.succeed(found);
};

const accountOf = (data: string | null, fallback: string): string => (data === null ? fallback : join(data, 'muse-code'));

const serve: MuseRunner['serve'] = (input) =>
  serveMcpOverHttp(input).pipe(
    Effect.mapError(
      (cause) => new AgentFault({ code: FAULT.internal, message: `Tagma's tools could not be served to Muse Code: ${cause.message}` }),
    ),
  );

const runMuse = Effect.fnUntraced(
  function* (at: Invoked, door: HostedDoor, launch: HostedLaunch) {
    const thread = at.env[MUSE_CODE_STORAGE];
    if (!thread) return yield* new AgentFault({ code: FAULT.internal, message: 'The Muse Code runner has no thread storage directory.' });
    const place: MusePlace = { account: accountOf(launch.data, join(thread, 'home')), config: join(thread, 'config') };
    const env = yield* prepareHome(place, at.env, process.platform);
    const program = yield* programOf(at.env);
    const sdk = yield* loadMuseSdk;
    const { input, write } = hostedStdio(at);
    yield* serveHosted(
      input,
      write,
      (running) =>
        Effect.map(
          makeMuseCycle(door, running, { place, env, program, mint: () => Bun.randomUUIDv7(), serve }, { ...launch, parameters: {} }),
          (cycle) => hostedAgent(cycle, door),
        ).pipe(Effect.provideService(MuseSdk, sdk)),
      (text) => process.stderr.write(text),
    );
  },
  Effect.scoped,
  Effect.provide(BunFileSystem.layer),
);

const decodeItem = Schema.decodeUnknownResult(ItemEvent);
const decodeUsage = Schema.decodeUnknownResult(TokenUsage);
const decodeEnd = Schema.decodeUnknownResult(TurnCompleted);

const runAsk = Effect.fnUntraced(
  function* (at: Invoked, { model, effort, system, data }: HostedAsk) {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ directory: at.cwd, prefix: 'tagma-muse-ask-' });
    const place: MusePlace = { account: accountOf(data, join(directory, 'home')), config: join(directory, 'config') };
    const env = yield* prepareHome(place, at.env, process.platform);
    yield* writeSettings(place, { system, toolset: [] });
    const program = yield* programOf(at.env);
    const decoder = new TextDecoder();
    const asked = yield* Stream.fromReadableStream({
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
    const session = Bun.randomUUIDv7();
    const turn = Bun.randomUUIDv7();
    const said: string[] = [];
    const spent: Tokens[] = [];
    const ended = yield* Deferred.make<typeof TurnCompleted.Type>();
    const frame = Effect.fnUntraced(function* (seen: Frame) {
      if (seen.method === 'item/completed') {
        const read = decodeItem(seen.params);
        if (Result.isSuccess(read) && read.success.item.kind === 'agentMessage' && read.success.item.turnId === turn)
          said.push(read.success.item.text ?? '');
      } else if (seen.method === 'session/tokenUsage') {
        const read = decodeUsage(seen.params);
        if (Result.isSuccess(read) && read.success.turnId === turn) spent.push(read.success.usage);
      } else if (seen.method === 'turn/completed') {
        const read = decodeEnd(seen.params);
        if (Result.isSuccess(read) && read.success.turnId === turn) yield* Deferred.succeed(ended, read.success);
      }
    });
    const sdk = yield* loadMuseSdk;
    const host = yield* sdk.open({
      program,
      args: ['serve', '--no-session-log'],
      cwd: directory,
      env,
      sessionMcp: false,
      frame,
      stderr: (text) => process.stderr.write(text),
    });
    const refused = (refusal: { readonly method: string; readonly message: string }) =>
      new AgentFault({ code: FAULT.internal, message: `Muse Code refused ${refusal.method}: ${refusal.message}` });
    yield* host
      .command('session/start', {
        sessionId: session,
        workspaceRoot: directory,
        modelId: model,
        providerId: 'meta',
        approvalMode: 'allowAll',
      })
      .pipe(Effect.mapError(refused));
    yield* host
      .command(
        'turn/start',
        { sessionId: session, input: [{ type: 'text', text: asked }], ...(effort === null ? {} : { reasoningEffort: effort }) },
        turn,
      )
      .pipe(Effect.mapError(refused));
    const end = yield* Effect.raceFirst(
      Deferred.await(ended),
      Effect.flatMap(host.ended, (reason) =>
        Effect.fail(new AgentFault({ code: FAULT.internal, message: `Muse Code ended before the ask finished: ${reason}` })),
      ),
    );
    if (end.terminal !== 'completed')
      return yield* new AgentFault({
        code: end.error?.kind === 'authRequired' ? FAULT.authRequired : FAULT.internal,
        message:
          end.error?.kind === 'authRequired'
            ? `unauthenticated: Muse Code is not signed in; run \`${LOGIN}\`. ${end.error.message}`
            : `${end.error?.kind ?? end.terminal}: ${end.error?.message ?? end.reason ?? 'Muse Code did not finish the ask.'}`,
      });
    const total = spent.map(spentOf).reduce(
      (sum, one) => ({
        inputTokens: sum.inputTokens + one.inputTokens,
        outputTokens: sum.outputTokens + one.outputTokens,
        cacheReadTokens: sum.cacheReadTokens + one.cachedReadTokens,
        cacheWriteTokens: sum.cacheWriteTokens + one.cachedWriteTokens,
        totalTokens: sum.totalTokens + one.totalTokens,
        reasoningTokens: sum.reasoningTokens + one.thoughtTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, reasoningTokens: 0 },
    );
    const stdio = yield* Stdio.Stdio;
    yield* Stream.run(
      Stream.make(`${JSON.stringify({ text: said.join('\n\n'), usage: spent.length === 0 ? undefined : total })}\n`),
      stdio.stdout(),
    );
  },
  Effect.scoped,
  Effect.provide(BunFileSystem.layer),
  Effect.provide(BunStdio.layer),
);

export const museCodeRunner: HostedRunner = { run: runMuse, ask: runAsk, cut: null };
