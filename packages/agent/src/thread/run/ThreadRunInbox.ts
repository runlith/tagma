import { Context, Deferred, Effect, Exit, Layer } from 'effect';
import type { ThreadSignal } from '../../transcript/parts';
import { ThreadRunConflictError } from '../storage/runs';
import type { ThreadInboxItem, ThreadInboxItemValues } from '../storage/inbox';
import {
  carriesWords,
  isCompactionRequest,
  isStepRequest,
  isUnreadSteer,
  keepsWith,
  opensTurn,
  standingCompaction,
  summarizerCohort,
  threadSignalOfInboxItem,
  waitsForTurn,
  type ThreadCompactionRequest,
  type ThreadInboxWords,
} from '../inboxItems';
import { ThreadOwner, ThreadInbox, ThreadStore, type ThreadWriteTx } from '../ThreadPorts';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadChanges } from './ThreadChanges';
import { ThreadRunLedger, type ThreadRunRef } from './ThreadRunLedger';
export type ThreadSignalEnqueueResult = 'delivered' | 'already-read' | 'queued' | 'not-running' | 'declined';
export type ThreadCompactionAcceptance =
  | {
      readonly status: 'requested';
      readonly item: ThreadCompactionRequest;
    }
  | {
      readonly status: 'joined';
    }
  | {
      readonly status: 'not-running';
    };
export type ThreadSignalQueue = {
  drain(): readonly ThreadSignal[];
  hasPending(): boolean;
  hasReadable(): boolean;
  subscribe(listener: (signal: ThreadSignal) => void): () => void;
  unread(): readonly ThreadSignal[];
  dispose(): void;
};
type SlotKey = readonly [occurredAt: string, accepted: number];
type SignalSlot = {
  signal: ThreadSignal;
  waits: boolean;
  ready: boolean;
  key: SlotKey | null;
  readonly outcome: Deferred.Deferred<Exit.Exit<ThreadSignalEnqueueResult, ThreadPortFailure>>;
};
type SignalQueue = {
  slots: SignalSlot[];
  accepted: number;
  readonly admitted: Map<string, SignalSlot | null>;
  readonly listeners: Set<(signal: ThreadSignal) => void>;
};
function after(left: SlotKey, right: SlotKey): boolean {
  return left[0] > right[0] || (left[0] === right[0] && left[1] > right[1]);
}
function place(queue: SignalQueue, slot: SignalSlot): void {
  const index = queue.slots.indexOf(slot);
  if (index >= 0) queue.slots.splice(index, 1);
  const key = slot.key;
  const at = key === null ? -1 : queue.slots.findIndex((other) => other.key === null || after(other.key, key));
  if (at < 0) queue.slots.push(slot);
  else queue.slots.splice(at, 0, slot);
}
export class ThreadRunInbox extends Context.Service<
  ThreadRunInbox,
  {
    enqueue(
      run: ThreadRunRef,
      item: ThreadInboxItemValues,
      condition?: (tx: ThreadWriteTx) => Effect.Effect<boolean, ThreadPortFailure>,
      accepted?: (result: ThreadSignalEnqueueResult, tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>,
    ): Effect.Effect<ThreadSignalEnqueueResult, ThreadPortFailure>;
    request(
      run: ThreadRunRef,
      item: ThreadCompactionRequest<ThreadInboxItemValues>,
      runCompacts: boolean,
    ): Effect.Effect<ThreadCompactionAcceptance, ThreadPortFailure>;
    requestBehind(
      threadId: string,
      item: ThreadCompactionRequest<ThreadInboxItemValues>,
    ): Effect.Effect<ThreadCompactionRequest | null, ThreadPortFailure>;
    takeRequest(run: ThreadRunRef): Effect.Effect<readonly ThreadCompactionRequest[], ThreadPortFailure>;
    read(run: ThreadRunRef): Effect.Effect<readonly ThreadSignal[], ThreadPortFailure>;
    hasPending(run: ThreadRunRef): Effect.Effect<boolean, ThreadPortFailure>;
    asksStep(run: ThreadRunRef): Effect.Effect<boolean, ThreadPortFailure>;
    takeBack(runId: string, id: string): boolean;
    signalQueue(runId: string): ThreadSignalQueue;
    forget(runId: string): void;
    steeredUnread(threadId: string): Effect.Effect<boolean, ThreadPortFailure>;
  }
>()('@runlith/agent/ThreadRunInbox') {}
export const threadRunInboxLayer: Layer.Layer<
  ThreadRunInbox,
  never,
  ThreadChanges | ThreadOwner | ThreadInbox | ThreadRunLedger | ThreadStore
> = Layer.effect(
  ThreadRunInbox,
  Effect.gen(function* () {
    const changes = yield* ThreadChanges;
    const owner = yield* ThreadOwner;
    const inbox = yield* ThreadInbox;
    const ledger = yield* ThreadRunLedger;
    const store = yield* ThreadStore;
    const queues = new Map<string, SignalQueue>();
    const underLock = (body: (tx: ThreadWriteTx) => Effect.Effect<unknown, ThreadPortFailure>): Effect.Effect<void, ThreadPortFailure> =>
      Effect.asVoid(store.transaction(body));
    const release = (queue: SignalQueue, slot: SignalSlot, read: boolean) => {
      const index = queue.slots.indexOf(slot);
      if (index >= 0) queue.slots.splice(index, 1);
      if (read) queue.admitted.set(slot.signal.id, null);
      else if (queue.admitted.get(slot.signal.id) === slot) queue.admitted.delete(slot.signal.id);
    };
    const reserve = (queue: SignalQueue, item: ThreadInboxWords): SignalSlot => {
      const slot: SignalSlot = {
        signal: threadSignalOfInboxItem(item),
        waits: waitsForTurn(item),
        ready: false,
        key: null,
        outcome: Deferred.makeUnsafe<Exit.Exit<ThreadSignalEnqueueResult, ThreadPortFailure>>(),
      };
      queue.admitted.set(item.id, slot);
      queue.slots.push(slot);
      return slot;
    };
    const ready = (run: ThreadRunRef, queue: SignalQueue, slot: SignalSlot, item: ThreadInboxWords<ThreadInboxItem>) => {
      slot.signal = threadSignalOfInboxItem(item);
      slot.waits = waitsForTurn(item);
      slot.ready = true;
      place(queue, slot);
      for (const listener of queue.listeners) listener(slot.signal);
    };
    const eligible = (item: ThreadInboxItem): item is ThreadInboxWords<ThreadInboxItem> =>
      item.state === 'queued' && carriesWords(item) && !opensTurn(item);
    const reconcile = (run: ThreadRunRef, only?: ReadonlySet<string>): Effect.Effect<readonly string[], ThreadPortFailure> =>
      Effect.suspend(() => {
        const queue = queues.get(run.id);
        if (!queue) return Effect.succeed([]);
        return Effect.gen(function* () {
          const present = (yield* inbox.pending(run.threadId)).filter(
            (item): item is ThreadInboxWords<ThreadInboxItem> => eligible(item) && (only === undefined || only.has(item.id)),
          );
          const candidates = present.filter((item) => !queue.admitted.has(item.id));
          if (candidates.length === 0) return present.map((item) => item.id);
          const rank = new Map(present.map((item, index) => [item.id, index - present.length]));
          yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              const slots = candidates
                .filter((item) => !queue.admitted.has(item.id))
                .map((item) => {
                  const slot = reserve(queue, item);
                  slot.key = [item.occurredAt, rank.get(item.id)!];
                  place(queue, slot);
                  return slot;
                });
              return slots;
            }),
            Effect.fnUntraced(function* (slots) {
              const accepted = new Map<string, ThreadInboxWords<ThreadInboxItem>>();
              if (slots.length === 0) return accepted;
              const wanted = new Set(slots.map((slot) => slot.signal.id));
              yield* underLock(
                Effect.fnUntraced(function* (tx) {
                  const active = yield* ledger.latestRun(run.threadId, ['running'], tx);
                  if (active?.id !== run.id || active.ownerId !== owner.id) {
                    return yield* Effect.fail(new ThreadRunConflictError({ threadId: run.threadId, runId: active?.id ?? run.id }));
                  }
                  for (const item of yield* inbox.pending(run.threadId, tx)) {
                    if (wanted.has(item.id) && eligible(item)) accepted.set(item.id, item);
                  }
                  return null;
                }),
              );
              for (const slot of slots) {
                const item = accepted.get(slot.signal.id);
                if (item) ready(run, queue, slot, item);
                else release(queue, slot, true);
              }
              return accepted;
            }),
            (slots, exit) =>
              Effect.sync(() => {
                for (const slot of slots) {
                  if (Exit.isFailure(exit)) release(queue, slot, false);
                  const outcome = Exit.isFailure(exit)
                    ? Exit.failCause(exit.cause)
                    : Exit.succeed<ThreadSignalEnqueueResult>(exit.value.has(slot.signal.id) ? 'delivered' : 'already-read');
                  Deferred.doneUnsafe(slot.outcome, Effect.succeed(outcome));
                }
              }),
          ).pipe(Effect.ensuring(changes.publish(run.threadId)));
          return present.map((item) => item.id);
        });
      });
    return ThreadRunInbox.of({
      enqueue: (run, item, condition, accepted) =>
        Effect.suspend(() => {
          const readable = carriesWords(item) && !opensTurn(item) ? item : null;
          const queue = readable === null ? undefined : queues.get(run.id);
          const held = queue?.admitted.get(item.id);
          if (held === null) return Effect.succeed<ThreadSignalEnqueueResult>('already-read');
          if (held)
            return Deferred.await(held.outcome).pipe(
              Effect.flatMap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.failCause(exit.cause)
                  : Effect.succeed<ThreadSignalEnqueueResult>(queue?.admitted.get(item.id) === null ? 'already-read' : exit.value),
              ),
            );
          return Effect.acquireUseRelease(
            Effect.sync(() => (queue && readable ? reserve(queue, readable) : null)),
            Effect.fnUntraced(function* (slot) {
              const outcome: {
                result: ThreadSignalEnqueueResult;
                item: ThreadInboxWords<ThreadInboxItem> | null;
              } = {
                result: 'not-running',
                item: null,
              };
              yield* underLock(
                Effect.fnUntraced(function* (tx) {
                  const active = yield* ledger.latestRun(run.threadId, ['running'], tx);
                  if (active?.id !== run.id) return null;
                  if (condition !== undefined && !(yield* condition(tx))) {
                    outcome.result = 'declined';
                    return null;
                  }
                  const put = yield* inbox.put(item, tx);
                  const readable = queue !== undefined && eligible(put.item) ? put.item : null;
                  if (slot && queue && readable) slot.key = [readable.occurredAt, ++queue.accepted];
                  outcome.item = readable;
                  outcome.result = put.item.state !== 'queued' ? 'already-read' : readable ? 'delivered' : 'queued';
                  if (accepted !== undefined) yield* accepted(outcome.result, tx);
                  return null;
                }),
              );
              if (outcome.result === 'delivered' && slot && queue && outcome.item) ready(run, queue, slot, outcome.item);
              return outcome.result;
            }),
            (slot, exit) =>
              Effect.sync(() => {
                if (!slot || !queue) return;
                if (Exit.isFailure(exit) || exit.value !== 'delivered') {
                  release(queue, slot, Exit.isSuccess(exit) && exit.value === 'already-read');
                }
                Deferred.doneUnsafe(slot.outcome, Effect.succeed(exit));
              }),
          );
        }).pipe(Effect.ensuring(changes.publish(run.threadId))),
      request: Effect.fnUntraced(
        function* (run, item, runCompacts) {
          const outcome: {
            answer: ThreadCompactionAcceptance;
          } = { answer: { status: 'not-running' } };
          yield* underLock(
            Effect.fnUntraced(function* (tx) {
              const active = yield* ledger.latestRun(run.threadId, ['running'], tx);
              if (active?.id !== run.id) return null;
              const pending = yield* inbox.pending(run.threadId, tx);
              const waiting = pending.filter((each) => each.state === 'queued');
              const keep = item.body.keep;
              const summarizer = item.body.summarizer;
              if (runCompacts && !keep?.trim() && summarizer === undefined && (item.body.at === 'step' || waiting.length === 0)) {
                outcome.answer = { status: 'joined' };
                return null;
              }
              const taking =
                item.body.at === 'step'
                  ? pending.find(
                      (each): each is ThreadCompactionRequest =>
                        isCompactionRequest(each) &&
                        each.state === 'delivered' &&
                        each.deliveredToRunId === run.id &&
                        each.body.at === 'step' &&
                        keepsWith(each, keep, summarizer),
                    )
                  : undefined;
              const standing = taking ?? standingCompaction(waiting, item.body.at, keep, summarizer);
              if (standing !== null) {
                outcome.answer = { status: 'requested', item: standing };
                return null;
              }
              const accepted = (yield* inbox.put(item, tx)).item;
              if (!isCompactionRequest(accepted)) {
                return yield* Effect.die(new Error(`Inbox item ${item.id} was accepted as ${accepted.kind}, not as a compaction request.`));
              }
              outcome.answer = { status: 'requested', item: accepted };
              return null;
            }),
          );
          return outcome.answer;
        },
        (effect, run, item, runCompacts) => effect.pipe(Effect.ensuring(changes.publish(run.threadId))),
      ),
      requestBehind: Effect.fnUntraced(
        function* (threadId, item) {
          const outcome: {
            accepted: ThreadCompactionRequest | null;
          } = { accepted: null };
          yield* underLock(
            Effect.fnUntraced(function* (tx) {
              if ((yield* ledger.latestRun(threadId, ['running'], tx)) !== null) return null;
              const waiting = (yield* inbox.pending(threadId, tx)).filter((each) => each.state === 'queued');
              const standing = standingCompaction(waiting, item.body.at, item.body.keep, item.body.summarizer);
              if (standing !== null) {
                outcome.accepted = standing;
                return null;
              }
              const accepted = (yield* inbox.put(item, tx)).item;
              if (!isCompactionRequest(accepted)) {
                return yield* Effect.die(new Error(`Inbox item ${item.id} was accepted as ${accepted.kind}, not as a compaction request.`));
              }
              outcome.accepted = accepted;
              return null;
            }),
          );
          return outcome.accepted;
        },
        (effect, threadId, item) => effect.pipe(Effect.ensuring(changes.publish(threadId))),
      ),
      takeRequest: Effect.fnUntraced(function* (run) {
        if (!(yield* inbox.pending(run.threadId)).some(isStepRequest)) return [];
        const outcome: {
          taken: readonly ThreadCompactionRequest[];
        } = { taken: [] };
        yield* underLock(
          Effect.fnUntraced(function* (tx) {
            const active = yield* ledger.latestRun(run.threadId, ['running'], tx);
            if (active?.id !== run.id || active.ownerId !== owner.id) return null;
            const items = summarizerCohort((yield* inbox.pending(run.threadId, tx)).filter(isStepRequest));
            if (items.length === 0) return null;
            yield* inbox.deliver(
              items.map((item) => item.id),
              run.id,
              tx,
            );
            outcome.taken = items;
            return null;
          }),
        );
        if (outcome.taken.length > 0) yield* changes.publish(run.threadId);
        return outcome.taken;
      }),
      read: Effect.fnUntraced(function* (run) {
        const queue = queues.get(run.id);
        if (!queue) return [];
        const initial = new Set(queue.slots.map((slot) => slot.signal.id));
        const observed = yield* reconcile(run);
        const ids = new Set([...initial, ...observed]);
        const cohort = queue.slots.filter((slot) => ids.has(slot.signal.id)).map((slot) => slot.signal.id);
        for (;;) {
          const pending = cohort.flatMap((id) => {
            const slot = queue.admitted.get(id);
            return slot && !slot.ready ? [slot] : [];
          });
          if (pending.length === 0) break;
          const outcomes = yield* Effect.forEach(pending, (slot) => Deferred.await(slot.outcome));
          if (outcomes.some(Exit.isFailure)) yield* reconcile(run, ids);
        }
        const members = new Set(cohort);
        const read = queue.slots.filter((slot) => slot.ready && members.has(slot.signal.id));
        for (const slot of read) release(queue, slot, true);
        return read.map((slot) => slot.signal);
      }),
      hasPending: (run) => reconcile(run).pipe(Effect.map(() => (queues.get(run.id)?.slots.length ?? 0) > 0)),
      asksStep: (run) => reconcile(run).pipe(Effect.map(() => queues.get(run.id)?.slots.some((slot) => !slot.waits) ?? false)),
      takeBack: (runId, id) => {
        const queue = queues.get(runId);
        if (!queue) return true;
        const slot = queue.admitted.get(id);
        if (slot === null || (slot && !slot.ready)) return false;
        if (slot) release(queue, slot, true);
        else queue.admitted.set(id, null);
        return true;
      },
      signalQueue: (runId) => {
        let queue = queues.get(runId);
        if (!queue) {
          queue = { slots: [], accepted: 0, admitted: new Map(), listeners: new Set() };
          queues.set(runId, queue);
        }
        const held = queue;
        return {
          drain: () => drainReadySignals(held),
          hasPending: () => held.slots.length > 0,
          hasReadable: () => held.slots[0]?.ready === true,
          subscribe: (listener) => {
            held.listeners.add(listener);
            return () => {
              held.listeners.delete(listener);
            };
          },
          unread: () => held.slots.filter((slot) => slot.ready).map((slot) => slot.signal),
          dispose: () => {
            if (queues.get(runId) === held) queues.delete(runId);
            held.slots.length = 0;
            held.listeners.clear();
          },
        };
      },
      forget: (runId) => {
        const queue = queues.get(runId);
        if (queue) {
          queue.slots.length = 0;
          queue.listeners.clear();
        }
        queues.delete(runId);
      },
      steeredUnread: (threadId) => inbox.pending(threadId).pipe(Effect.map((items) => items.some(isUnreadSteer))),
    });
  }),
);
function drainReadySignals(queue: SignalQueue): readonly ThreadSignal[] {
  const ready: ThreadSignal[] = [];
  while (queue.slots[0]?.ready) {
    const slot = queue.slots.shift()!;
    queue.admitted.set(slot.signal.id, null);
    ready.push(slot.signal);
  }
  return ready;
}
