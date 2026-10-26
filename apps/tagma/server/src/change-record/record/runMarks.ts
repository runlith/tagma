import { and, eq } from 'drizzle-orm';
import { type Context, Effect, FiberSet, Layer } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { ThreadRecords, type StatusPublished } from '../../thread-record/contract/service/records.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { held, workspaceChange } from '../store/tables.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

export const runEnded = (event: StatusPublished): boolean => event.fromRunId !== null && event.runningRunId !== event.fromRunId;

const checkoutsOfThread = (store: StoreShape, threadId: string): Effect.Effect<readonly string[], StoreFailure> =>
  store.db
    .selectDistinct({ checkout: workspaceChange.checkout })
    .from(workspaceChange)
    .where(and(eq(workspaceChange.holder, threadId), held))
    .pipe(Effect.map((rows) => rows.map((row) => row.checkout)));

export const runMarks = Effect.fnUntraced(function* (
  records: ThreadRecords['Service'],
  store: StoreShape,
  told: (checkouts: readonly string[]) => Effect.Effect<void>,
) {
  const runFork = yield* FiberSet.makeRuntime<never, void, never>();
  const mark = (threadId: string) =>
    runFork(
      Effect.flatMap(checkoutsOfThread(store, threadId), (checkouts) => (checkouts.length === 0 ? Effect.void : told(checkouts))).pipe(
        Effect.catchCause((cause) => Effect.logWarning('a run’s end reached no checkout reading', { threadId, cause })),
      ),
    );
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      records.statusPublished((event) =>
        Effect.sync(() => {
          if (runEnded(event)) mark(event.threadId);
        }),
      ),
    ),
    (detach) => Effect.sync(detach),
  );
});

export const runMarksLayer: Layer.Layer<never, never, MachineStore | ThreadRecords | CheckoutRows> = Layer.effectDiscard(
  Effect.gen(function* () {
    const records = yield* ThreadRecords;
    const store = yield* MachineStore;
    const checkouts = yield* CheckoutRows;
    yield* runMarks(records, store, (held) =>
      Effect.forEach(held, (checkout) => checkouts.mark(RootId.make(checkout), 'run-ended'), { discard: true }),
    );
  }),
);
