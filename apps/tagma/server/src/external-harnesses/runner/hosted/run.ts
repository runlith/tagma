import { Deferred, Effect, Stream } from 'effect';
import { AgentFault, FAULT, serve, type AgentHandlers, type Outlet } from '@runlith/acp/agent';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import type { Process } from './cycle.js';

const INPUT_LINE_BYTES = 64 * 1024 * 1024;

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
