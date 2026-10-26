import { Clock, Context, type Duration, Effect, Exit, Layer, Option } from 'effect';
import type { ThreadMetadataRow } from '../rows';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadInbox, ThreadResourceLedger, ThreadStore, ThreadTransitions, type ThreadWriteTx } from '../ThreadPorts';
import { type ThreadDeleteBlocker, ThreadDeleteConflictError, ThreadDeleteStillSettlingError } from '../storage/aggregate';
import { RunExecution } from './RunExecution';
import { ThreadRunLedger, type ThreadRunRef } from './ThreadRunLedger';
import { ThreadSettlementOutbox } from './ThreadSettlementOutbox';
import { ThreadStopping } from './ThreadStopping';
import { LaunchGate } from './LaunchGate';
import { ThreadSnapshots } from './ThreadSnapshots';
import { ActivityLog } from '@runlith/activity/log';
import { RunAdmission } from './runAdmission';
const DELETE_ATTEMPTS = 2;
type RunWork = { readonly run: ThreadRunRef; readonly ended: Effect.Effect<void> };
export class ThreadDeletion extends Context.Service<
  ThreadDeletion,
  {
    remove(ownerId: string, threadId: string, within?: Duration.Duration): Effect.Effect<boolean, ThreadBorderFailed>;
    delete(thread: ThreadMetadataRow, within?: Duration.Duration): Effect.Effect<boolean, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadDeletion') {}
export const makeThreadDeletion = Effect.gen(function* () {
  const store = yield* ThreadStore;
  const transitions = yield* ThreadTransitions;
  const ledger = yield* ThreadRunLedger;
  const inbox = yield* ThreadInbox;
  const stopping = yield* ThreadStopping;
  const execution = yield* RunExecution;
  const resources = yield* ThreadResourceLedger;
  const snapshots = yield* ThreadSnapshots;
  const gate = yield* LaunchGate;
  const outbox = yield* ThreadSettlementOutbox;
  const log = yield* ActivityLog;
  const admission = yield* RunAdmission;
  const stillSettling = (run: ThreadRunRef) => new ThreadCallBroke({ cause: new ThreadDeleteStillSettlingError(run.threadId, run.id) });
  const leftOf = (ids: readonly string[]): readonly RunWork[] => [
    ...execution.driven(ids).map((run) => ({ run, ended: execution.drained(run.id) })),
    ...outbox.publishing(ids).map((publishing) => ({ run: publishing.run, ended: publishing.delivered })),
  ];
  const drained = Effect.fn('ThreadDeletion.drained')(function* (left: RunWork, within: Duration.Duration | undefined) {
    const ended = within === undefined ? Option.some(yield* left.ended) : yield* Effect.timeoutOption(left.ended, within);
    if (Option.isNone(ended)) return yield* stillSettling(left.run);
  });
  const settle = Effect.fn('ThreadDeletion.settle')(function* (
    tree: readonly ThreadMetadataRow[],
    within: Duration.Duration | undefined,
  ): Effect.fn.Return<void, ThreadBorderFailed> {
    const rows = new Map(tree.map((row) => [row.id, row]));
    const going = yield* ledger.runningOf([...rows.keys()]);
    const stopped = Effect.forEach(
      going,
      Effect.fnUntraced(function* (run) {
        const waiting = (yield* inbox.pending(run.threadId)).filter((item) => item.state === 'queued');
        if (waiting.length > 0)
          yield* inbox.acknowledge(
            waiting.map((item) => item.id),
            null,
          );
        const thread = rows.get(run.threadId);
        if (thread === undefined) return;
        const stopped = yield* stopping.stop(thread, { door: 'delete', by: 'reader', expected: run.id, settled: { within } });
        if (stopped.status === 'still-settling') return yield* stillSettling(run);
      }),
      { concurrency: 'unbounded', discard: true },
    );
    yield* stopped;
    yield* Effect.forEach(leftOf([...rows.keys()]), (left) => drained(left, within), { concurrency: 'unbounded', discard: true });
    yield* snapshots.forget([...rows.keys()]);
  });
  const clear = Effect.fn('ThreadDeletion.clear')(function* (
    root: ThreadMetadataRow,
    settled: ReadonlySet<string>,
    unit: ThreadWriteTx,
  ): Effect.fn.Return<ThreadDeleteBlocker | 'absent' | null, ThreadBorderFailed> {
    const standing = yield* store.holdSubtree(root.ownerId, root.id, unit);
    if (standing.length === 0) return 'absent';
    const arrived = standing.find((row) => !settled.has(row.id));
    if (arrived) return { kind: 'child', id: arrived.id } satisfies ThreadDeleteBlocker;
    const ids = standing.map((row) => row.id);
    const running = (yield* ledger.runningOf(ids, unit))[0] ?? leftOf(ids)[0]?.run;
    if (running) return { kind: 'run', id: running.id } satisfies ThreadDeleteBlocker;
    yield* resources.end(ids, unit);
    yield* transitions.spend(ids, new Date(yield* Clock.currentTimeMillis), unit);
    yield* store.delete(ids, unit);
    return null;
  });
  const deleteTree = Effect.fn('ThreadDeletion.delete')(function* (
    thread: ThreadMetadataRow,
    within?: Duration.Duration,
  ): Effect.fn.Return<boolean, ThreadBorderFailed> {
    for (let attempt = 1; ; attempt += 1) {
      const tree = yield* store.listSubtree(thread.ownerId, thread.id);
      if (tree.length === 0) return false;
      const ids = tree.map((row) => row.id);
      const outcome = yield* Effect.acquireUseRelease(
        Effect.sync(() => admission.hold(ids)),
        () =>
          Effect.gen(function* () {
            yield* settle(tree, within);
            if (within === undefined) yield* log.settled;
            else if (Option.isNone(yield* Effect.timeoutOption(log.settled, within)))
              return yield* new ThreadCallBroke({ cause: new ThreadDeleteStillSettlingError(thread.id, null) });
            return yield* store.transaction((unit) => clear(thread, new Set(ids), unit));
          }),
        (lift, exit) => Effect.sync(() => lift(Exit.isFailure(exit) || (exit.value !== null && exit.value !== 'absent'))),
      );
      if (outcome === 'absent') return false;
      if (outcome === null) {
        yield* resources.letGo();
        return true;
      }
      if (attempt === DELETE_ATTEMPTS) {
        return yield* new ThreadCallBroke({ cause: new ThreadDeleteConflictError({ threadId: thread.id, blockedBy: outcome }) });
      }
    }
  });
  return ThreadDeletion.of({
    remove: Effect.fn('ThreadDeletion.remove')(function* (ownerId, threadId, within) {
      const thread = yield* store.findOwned(threadId, ownerId);
      if (!thread) return false;
      if (!(yield* deleteTree(thread, within))) return false;
      gate.lift(threadId);
      if (thread.parentThreadId) yield* snapshots.publish(thread.parentThreadId);
      return true;
    }),
    delete: deleteTree,
  });
});

export const threadDeletionLayer = Layer.effect(ThreadDeletion, makeThreadDeletion);
