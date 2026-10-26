import { Effect, Queue, Stream } from 'effect';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { ProcessDelivery } from '../ProcessControl';
import type { ProcessReader } from '../ProcessReader';
import { processControl } from './control';

export const YIELD_SIGNAL = 'SIGUSR2';

export const yieldRequests = Effect.gen(function* () {
  const asks = yield* Effect.acquireRelease(Queue.sliding<void>(1), Queue.shutdown);
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const asked = () => void Queue.offerUnsafe(asks, undefined);
      process.on(YIELD_SIGNAL, asked);
      return asked;
    }),
    (asked) => Effect.sync(() => void process.off(YIELD_SIGNAL, asked)),
  );
  return { asked: Stream.fromQueue(asks) };
});

export const askLogicToYield =
  (reader: ProcessReader) =>
  (witness: ProcessWitness): Effect.Effect<ProcessDelivery> =>
    processControl(reader).signal(witness, YIELD_SIGNAL);
