import { Clock, Effect } from 'effect';
import { AGENT_CHILD_UPDATE_SIGNAL_TYPE, type AgentChildUpdate, type WakeCost } from '@runlith/agent/contracts';
import type { ThreadRunSettled } from '@runlith/agent/thread/run/ThreadRunLedger';
import { type ThreadBorderFailed, ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { entryOf } from '@runlith/agent/transcript/kinds';
import { compactedLine, cooledLine, modelChangedLine, ranLine, wakeCostOf } from '@runlith/agent/collaboration/wakeCost';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { NativeStorage } from '../contract/service/engine.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import { isPromised, type PromisedWarmth, type ThreadEvent, type ThreadEventRecipient, type ThreadWarmth } from '../events/happened.js';
import type { ThreadSummary } from '../list/summary.js';
import type { ChildReads } from './childReads.js';
import type { ModelChange } from '../contract/service/modelChanges.js';
import { stateLines, type EventLines } from '../subscriptions/delivery.js';

export type ChildUpdatesInput = {
  readonly threads: ThreadLookup['Service'];
  readonly storage: NativeStorage['Service'];
  readonly warmth: ThreadWarmth;
  readonly reads: ChildReads;
  readonly lines: EventLines;
};

export const CHILD_UPDATES_SUBSCRIBER = 'child updates';

const labelOf = (thread: ThreadSummary) => thread.name ?? thread.id;

const updateOf = (
  child: ThreadSummary,
  event: Exclude<AgentChildUpdate['event'], 'model-changed' | 'deleted'>,
  cost: WakeCost,
  forOperator = false,
): AgentChildUpdate => ({
  kind: 'child-update',
  child: { threadId: child.id, projectId: child.projectId, name: child.name },
  event,
  forOperator,
  cost,
});

const follows = (child: ThreadSummary): boolean =>
  child.archivedAt === null && child.parentThreadId !== null && child.ownerId === OPERATOR_PRINCIPAL;

export const makeChildUpdates = Effect.fnUntraced(function* ({ threads, storage, warmth, reads, lines }: ChildUpdatesInput) {
  const parentOf = Effect.fnUntraced(function* (child: ThreadSummary) {
    const parentId = child.parentThreadId;
    if (parentId === null || !follows(child)) return null;
    const parent = yield* threads.summary(parentId);
    return parent === undefined || parent.archivedAt !== null ? null : parent;
  });

  const tell = (parent: ThreadSummary, key: string, text: string, update: AgentChildUpdate) => {
    const about = update.child.threadId;
    return lines({
      subscriberId: parent.id,
      about,
      type: AGENT_CHILD_UPDATE_SIGNAL_TYPE,
      key: `${update.event}:${parent.id}:${key}`,
      text,
      notice: update,
      wakes: false,
      replaces: update.event === 'model-changed' ? [`${AGENT_CHILD_UPDATE_SIGNAL_TYPE}:${about}:model-changed:`] : stateLines(about),
    });
  };

  const cooled = Effect.fnUntraced(function* (child: ThreadSummary, judged: PromisedWarmth) {
    const parent = yield* parentOf(child);
    if (parent === null) return;
    const text = cooledLine(labelOf(child), judged.heldTokens);
    yield* tell(parent, String(Date.parse(judged.expiresAt)), text, updateOf(child, 'cooled', { kind: 'cold', tokens: judged.heldTokens }));
  });

  const ran = Effect.fnUntraced(function* (
    parent: ThreadSummary,
    child: ThreadSummary,
    event: ThreadRunSettled,
    byOperator: Effect.Effect<boolean, ThreadBorderFailed>,
  ) {
    if (yield* reads.reported(parent.id, child.id, event.runId)) return;
    const judged = yield* warmth(child, yield* Clock.currentTimeMillis);
    if (isPromised(judged) && judged.state === 'cold') return;
    const forOperator = yield* byOperator;
    const reading = child.contextReading?.runId === event.runId ? child.contextReading : null;
    const cost = wakeCostOf(reading === null ? null : yield* warmth(child, Date.parse(reading.measuredAt)));
    const text = ranLine(labelOf(child), cost, forOperator);
    yield* tell(parent, event.runId, text, updateOf(child, 'ran', cost, forOperator));
  });

  const compacted = Effect.fnUntraced(function* (parent: ThreadSummary, child: ThreadSummary, event: ThreadRunSettled) {
    const entries = yield* storage.threads.entriesOfRun(child.id, event.runId);
    const done = entries.filter(entryOf('compaction')).find((entry) => entry.runId === event.runId && entry.status === 'completed');
    if (done === undefined) return;
    const tokens = done.receipt?.postTokens ?? null;
    const text = compactedLine(labelOf(child), tokens);
    yield* tell(parent, event.runId, text, updateOf(child, 'compacted', { kind: 'unknown', tokens }));
  });

  const settled = Effect.fn('ChildUpdates.settled')(
    function* (child: ThreadSummary, event: ThreadRunSettled, byOperator: Effect.Effect<boolean, ThreadBorderFailed>) {
      const parent = yield* parentOf(child);
      if (parent === null) return;
      if (event.status === 'withdrawn' || event.stoppedBy === 'parent') return;
      if (event.kind === 'turn') yield* ran(parent, child, event, byOperator);
      if (event.kind === 'compaction' && event.status === 'completed') yield* compacted(parent, child, event);
    },
    Effect.mapError((cause) => new ThreadCallBroke({ cause })),
  );

  const modelChanged = Effect.fn('ChildUpdates.modelChanged')(
    function* (child: ThreadSummary, change: ModelChange) {
      const parent = yield* parentOf(child);
      if (parent === null) return;
      yield* tell(parent, change.id, modelChangedLine(labelOf(child), change.from, change.to), {
        kind: 'child-update',
        child: { threadId: child.id, projectId: child.projectId, name: child.name },
        event: 'model-changed',
        from: change.from,
        to: change.to,
        forOperator: false,
        cost: { kind: 'unknown', tokens: null },
      });
    },
    Effect.mapError((cause) => new ThreadCallBroke({ cause })),
  );

  const handle = (event: ThreadEvent) => {
    if (event.kind === 'model-changed') return modelChanged(event.thread, event.change);
    if (event.kind === 'cooled') return cooled(event.thread, event.warmth).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    return event.kind === 'ended' && event.latest ? settled(event.thread, event.run, event.byOperator) : Effect.void;
  };

  const recipient: ThreadEventRecipient = {
    name: CHILD_UPDATES_SUBSCRIBER,
    takes: ['ended', 'cooled', 'model-changed'],
    follows: (child) => Effect.succeed(follows(child)),
    handle,
  };

  return { recipient };
});
