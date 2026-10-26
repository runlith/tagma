import { Context, Deferred, Effect, Layer } from 'effect';
import { ThreadInbox, ThreadLeaseRhythm, ThreadStore } from '../ThreadPorts';
import { RunScheduler } from './scheduler/RunScheduler';

const BATCH = 50;

export class SenderWakes extends Context.Service<
  SenderWakes,
  {
    kick(): Effect.Effect<void>;
    drain(): Effect.Effect<number>;
  }
>()('@runlith/agent/SenderWakes') {}

export const senderWakesLayer = Layer.effect(
  SenderWakes,
  Effect.gen(function* () {
    const scheduler = yield* RunScheduler;
    const inbox = yield* ThreadInbox;
    const store = yield* ThreadStore;
    const rhythm = yield* ThreadLeaseRhythm;
    let kicked = yield* Deferred.make<void>();

    const settle = Effect.fnUntraced(function* (id: string) {
      const item = yield* inbox.receipt(id);
      const thread = item === undefined ? undefined : yield* store.metadata(item.threadId);
      if (item === undefined || item.state !== 'queued' || thread === undefined) return true;
      const admitted = yield* scheduler.admit(thread, { kind: 'item', item });
      yield* Effect.logInfo('sender wake admitted', { item: item.id, status: admitted.status });
      return true;
    });

    const drain = Effect.fnUntraced(function* (): Effect.fn.Return<number> {
      const read = yield* Effect.result(inbox.pendingWakes(BATCH));
      if (read._tag === 'Failure') {
        yield* Effect.logWarning('pending sender wakes could not be read; trying again', { failure: read.failure });
        return 0;
      }
      if (read.success.length > 0) yield* Effect.logInfo('sender wakes pending', { count: read.success.length });
      let admitted = 0;
      for (const item of read.success) {
        const settled = yield* Effect.result(settle(item.id));
        if (settled._tag === 'Failure') {
          yield* Effect.logWarning('a queued sender wake did not open its thread; it stays pending', {
            item: item.id,
            failure: settled.failure,
          });
          continue;
        }
        const acknowledged = yield* Effect.result(inbox.woke([item.id]));
        if (acknowledged._tag === 'Failure') {
          yield* Effect.logWarning('a sender wake was settled but not marked woken; the next drain settles it again', {
            item: item.id,
            failure: acknowledged.failure,
          });
          continue;
        }
        admitted += 1;
      }
      return admitted;
    });

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* drain();
          yield* Effect.raceFirst(Deferred.await(kicked), Effect.sleep(rhythm.heartbeatIntervalMs));
          kicked = yield* Deferred.make<void>();
        }),
      ),
    );

    return SenderWakes.of({
      kick: () => Effect.asVoid(Deferred.succeed(kicked, undefined)),
      drain,
    });
  }),
);
