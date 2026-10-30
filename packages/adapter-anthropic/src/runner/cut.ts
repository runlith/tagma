import { join } from 'node:path';
import { homedir } from 'node:os';
import { Data, Effect, FileSystem, Result, Schema, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { frame, type Envelope } from '@runlith/ndjson-rpc/envelope';
import { ExchangeFailed, inbound } from '@runlith/ndjson-rpc/exchange';
import type { Invoked } from '@runlith/hosted-runner/run';
import { turnAddresses } from '../harness/chain.js';
import { CUT_METHODS, ForkAsked, type Forked, TurnsAsked, type Turns } from '../harness/cut.js';

export class CutRefused extends Data.TaggedError('CutRefused')<{ readonly code: number; readonly message: string }> {}

export type Forking = (
  root: string,
  options: { readonly dir: string; readonly upToMessageId?: string },
) => Effect.Effect<string, CutRefused>;

export type CutPorts = { readonly fork: Forking; readonly home: string };

const INVALID_PARAMS = -32602;
const NOT_FOUND = -32002;
const METHOD_NOT_FOUND = -32601;
const INTERNAL = -32603;
const PARSE = -32700;
const LINE_BYTES = 1024 * 1024;

const params = <A>(method: string, schema: Schema.Decoder<A>, given: unknown) => {
  const decoded = Schema.decodeUnknownResult(schema)(given ?? {});
  return Result.isFailure(decoded)
    ? Effect.fail(
        new CutRefused({ code: INVALID_PARAMS, message: `${method} params do not match the cut server: ${decoded.failure.message}` }),
      )
    : Effect.succeed(decoded.success);
};

export const serveCut = Effect.fnUntraced(function* (
  input: Stream.Stream<Uint8Array, ExchangeFailed>,
  write: (bytes: Uint8Array) => Effect.Effect<void, ExchangeFailed>,
  ports: CutPorts,
) {
  const files = yield* FileSystem.FileSystem;
  const encoder = new TextEncoder();
  const projects = join(ports.home, 'projects');
  const send = (envelope: Envelope) => write(encoder.encode(frame(envelope)));

  const transcript = Effect.fn('claudeCut.transcript')(
    function* (sessionId: string) {
      const name = `${sessionId}.jsonl`;
      for (const project of yield* files.readDirectory(projects)) {
        const path = join(projects, project, name);
        if (yield* files.exists(path)) return path;
      }
      return yield* new CutRefused({ code: NOT_FOUND, message: `no transcript of session ${sessionId} stands under ${projects}` });
    },
    (effect) =>
      Effect.catchTag(effect, 'PlatformError', (failure) =>
        Effect.fail(
          new CutRefused({
            code: failure.reason._tag === 'NotFound' ? NOT_FOUND : INTERNAL,
            message: `${projects} could not be read: ${failure.message}`,
          }),
        ),
      ),
  );

  const fork = Effect.fn('claudeCut.fork')(function* (asked: ForkAsked) {
    const sessionId = yield* ports.fork(
      asked.root,
      asked.address === null ? { dir: asked.dir } : { dir: asked.dir, upToMessageId: asked.address },
    );
    return { sessionId, path: yield* transcript(sessionId) } satisfies Forked;
  });

  const turns = Effect.fn('claudeCut.turns')(function* (asked: TurnsAsked) {
    const path = yield* transcript(asked.root);
    const text = yield* files
      .readFileString(path)
      .pipe(Effect.mapError((failure) => new CutRefused({ code: INTERNAL, message: `${path} could not be read: ${failure.message}` })));
    return { addresses: turnAddresses(text) } satisfies Turns;
  });

  const answer = (method: string, given: unknown): Effect.Effect<unknown, CutRefused> => {
    if (method === CUT_METHODS.initialize) return Effect.succeed({ name: 'tagma-claude-cut' });
    if (method === CUT_METHODS.fork) return Effect.flatMap(params(method, ForkAsked, given), fork);
    if (method === CUT_METHODS.turns) return Effect.flatMap(params(method, TurnsAsked, given), turns);
    return Effect.fail(new CutRefused({ code: METHOD_NOT_FOUND, message: `the cut server does not answer ${method}` }));
  };

  yield* Stream.runForEach(
    inbound(() => input, { offset: 0n, torn: false }, LINE_BYTES),
    ({ message }) => {
      if (message._tag === 'Malformed') return send({ _tag: 'Error', id: null, error: { code: PARSE, message: message.problem } });
      if (message._tag !== 'Request') return Effect.void;
      return answer(message.method, message.params).pipe(
        Effect.match({
          onSuccess: (result): Envelope => ({ _tag: 'Result', id: message.id, result }),
          onFailure: (refused): Envelope => ({ _tag: 'Error', id: message.id, error: { code: refused.code, message: refused.message } }),
        }),
        Effect.flatMap(send),
      );
    },
  ).pipe(
    Effect.catchTag('ExchangeOversized', (over) =>
      Effect.fail(new ExchangeFailed({ detail: `a line from Tagma passed ${over.ceiling} bytes at byte ${over.start}` })),
    ),
  );
});

export const runCut = Effect.fnUntraced(function* (at: Invoked) {
  const sdk = yield* Effect.promise(() => import('@anthropic-ai/claude-agent-sdk'));
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
  const fork: Forking = (root, options) =>
    Effect.tryPromise({
      try: () => sdk.forkSession(root, options).then((forked) => forked.sessionId),
      catch: (cause) =>
        new CutRefused({
          code: INTERNAL,
          message: `the Agent SDK could not fork ${root}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  const home = at.env.CLAUDE_CONFIG_DIR || join(at.env.HOME ?? homedir(), '.claude');
  yield* serveCut(input, write, { fork, home }).pipe(Effect.provide(BunFileSystem.layer));
});
