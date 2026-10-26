import { Effect, Layer } from 'effect';
import { EndingRunner, EndingStages } from '../ending';
import { storageFailed } from '../ThreadBorder';
import { ThreadStore } from '../ThreadPorts';
import { RunEndings } from './lifecycle/endings';
import { ThreadSettlementOutbox } from './ThreadSettlementOutbox';
import { ThreadSnapshots } from './ThreadSnapshots';

export const endingDriveLayer: Layer.Layer<
  never,
  never,
  EndingRunner | EndingStages | RunEndings | ThreadSettlementOutbox | ThreadSnapshots | ThreadStore
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const runner = yield* EndingRunner;
    const endings = yield* RunEndings;
    const stages = yield* EndingStages;
    const outbox = yield* ThreadSettlementOutbox;
    const snapshots = yield* ThreadSnapshots;
    const store = yield* ThreadStore;
    yield* outbox.bind({
      runner: {
        run: Effect.fnUntraced(function* (ended) {
          const standing = yield* stages.read(ended.ending);
          if (standing === null)
            yield* endings.restore(ended.threadId, ended.ending).pipe(Effect.mapError(storageFailed('endings.restore')));
          const owed = standing ?? (yield* stages.read(ended.ending));
          yield* runner.run(ended);
          if (owed === null || !owed.owed.includes('settled')) return;
          const child = yield* store.metadata(owed.ended.threadId).pipe(Effect.mapError(storageFailed('endings.parent')));
          if (child?.parentThreadId) {
            yield* snapshots.publish(child.parentThreadId).pipe(Effect.mapError(storageFailed('endings.parent')));
          }
        }),
        recover: (input) => runner.recover(input),
      },
      publish: snapshots.publish,
    });
  }),
);
