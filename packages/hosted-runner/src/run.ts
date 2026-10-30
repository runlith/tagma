import { Deferred, Effect, Stream } from 'effect';
import { AgentFault, FAULT, serve, type AgentHandlers, type Outlet } from '@runlith/acp/agent';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import type { Process } from './cycle.js';
import type { HostedDoor } from './door.js';

const INPUT_LINE_BYTES = 64 * 1024 * 1024;

export type Invoked = {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: () => ReadableStream<Uint8Array>;
};

export type HostedLaunch = {
  readonly model: string | null;
  readonly effort: string | null;
  readonly version: string;
  readonly titled: boolean;
};

export type HostedAsk = {
  readonly model: string;
  readonly effort: string | null;
  readonly system: string;
};

export type HostedRunner = {
  readonly run: (at: Invoked, door: HostedDoor, launch: HostedLaunch) => Effect.Effect<void, unknown>;
  readonly cut: ((at: Invoked) => Effect.Effect<void, unknown>) | null;
  readonly ask?: (at: Invoked, ask: HostedAsk) => Effect.Effect<void, unknown>;
};

export type AgentFactory<R> = (process: Process) => Effect.Effect<(outlet: Outlet) => AgentHandlers<never>, AgentFault, R>;

export const serveHosted = Effect.fnUntraced(function* <R>(
  input: Stream.Stream<Uint8Array, ExchangeFailed>,
  write: (bytes: Uint8Array) => Effect.Effect<void, ExchangeFailed>,
  factory: AgentFactory<R>,
  stderr: (text: string) => void,
) {
  const died = yield* Deferred.make<string>();
  const process: Process = { stderr, died: (reason) => Effect.asVoid(Deferred.succeed(died, reason)) };
  const agent = yield* factory(process);
  yield* serve(input.pipe(Stream.interruptWhen(Deferred.await(died))), write, INPUT_LINE_BYTES, agent).pipe(
    Effect.catchTag('ExchangeOversized', (over) =>
      Effect.fail(new ExchangeFailed({ detail: `a line from Tagma passed ${over.ceiling} bytes at byte ${over.start}` })),
    ),
  );
  if (yield* Deferred.isDone(died))
    return yield* new AgentFault({
      code: FAULT.internal,
      message: `the hosted session ended, so this runner ends with it: ${yield* Deferred.await(died)}`,
    });
}, Effect.scoped);
