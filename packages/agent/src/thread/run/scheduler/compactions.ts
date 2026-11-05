import { Cause, Clock, Deferred, Effect, Ref } from 'effect';
import { compactionEntryId } from '../../../transcript/entryNames';
import {
  keptWordsOf,
  barrierIdAhead,
  beforeBarrier,
  behindBarrier,
  compactionHead,
  inboxCompactionValues,
  inboxSignalValues,
  isCompactionRequest,
  isReaderWordsItem,
  namedSummarizerOf,
  opensTurn,
  type ThreadCompactionRequest,
} from '../../inboxItems';
import { threadCompactionEvent } from '../../events';
import { actDigest } from '../../keyed';
import { cannotOn } from '../../record';
import type { ThreadMetadataRow, ThreadRow, ThreadRunRow } from '../../rows';
import type { ThreadCompactionPoint, ThreadInboxItem, ThreadInboxItemValues } from '../../storage/inbox';
import { ThreadRunConflictError, type ThreadRunStartKey } from '../../storage/runs';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed } from '../../ThreadBorder';
import { ThreadInbox, type ThreadTx, type ThreadWriteTx } from '../../ThreadPorts';
import { controlIfPresent, type TransitionDeps } from '../../transition/kernel';
import type { Decision } from '../../transition/port';
import type { ThreadSummarizerSelection, ThreadSummarizing } from '../../compaction/summarizer';
import { ThreadNoSummarizerError } from '../../storage/compaction';
import { RunExecution } from '../RunExecution';
import { ThreadCompactor } from '../ThreadCompaction';
import {
  type ThreadCompactAsk,
  type ThreadCompactionAhead,
  type ThreadCompactionAsked,
  type ThreadCompactionOpened,
  type ThreadCompactionRunInput,
  ThreadCompactionRuns,
} from '../ThreadCompactionRuns';
import { ThreadRunInbox } from '../ThreadRunInbox';
import { ThreadRunLedger } from '../ThreadRunLedger';
import { ThreadSnapshots } from '../ThreadSnapshots';
import type { CompactionOrder, Handover } from './handover';
import type { Openings } from './openings';
import { racing } from './racing';
export type ThreadCompacted =
  | {
      readonly status: 'started';
      readonly runId: string;
    }
  | {
      readonly status: 'requested';
      readonly requestId: string;
      readonly at: ThreadCompactionPoint;
      readonly runId: string;
    };
function compactsNow(latest: ThreadRunRow | null, pending: readonly ThreadInboxItem[]): boolean {
  return latest === null || latest.status === 'cut' || !beforeBarrier(pending).some((item) => opensTurn(item) || isReaderWordsItem(item));
}
export type Compactions = Effect.Success<ReturnType<typeof makeCompactions>>;
export const makeCompactions = Effect.fnUntraced(function* ({
  kernel,
  openings,
  handover,
}: {
  readonly kernel: TransitionDeps<ThreadTx, ThreadWriteTx>;
  readonly openings: Openings;
  readonly handover: Handover;
}) {
  const runs = yield* ThreadCompactionRuns;
  const execution = yield* RunExecution;
  const compactor = yield* ThreadCompactor;
  const inbox = yield* ThreadInbox;
  const runInbox = yield* ThreadRunInbox;
  const ledger = yield* ThreadRunLedger;
  const snapshots = yield* ThreadSnapshots;
  const waits = new Map<string, Deferred.Deferred<void>>();
  const settled = Effect.fnUntraced(function* (threadId: string, runId: string): Effect.fn.Return<void, ThreadBorderFailed> {
    const gate = yield* Deferred.make<void>();
    waits.set(runId, gate);
    const active = yield* ledger.activeRun(threadId);
    if (active?.id !== runId) {
      waits.delete(runId);
      return;
    }
    yield* Deferred.await(gate);
  });
  const ordered = Effect.fnUntraced(function* (
    input: ThreadCompactionRunInput,
    held: Ref.Ref<readonly ThreadCompactionRequest[]>,
    entering: Ref.Ref<ThreadRunRow | null>,
  ): Effect.fn.Return<CompactionOrder | null, ThreadBorderFailed> {
    const requests = yield* Ref.get(held);
    const run = yield* Ref.get(entering);
    if (input.requests?.alone === true && requests.length === 0 && run !== null) {
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      yield* runs.recordEntry(input.thread.id, {
        type: 'compaction',
        id: compactionEntryId(run.id),
        runId: run.id,
        mode: input.mode ?? 'manual',
        status: 'unchanged',
        occurredAt: run.startedAt.toISOString(),
        updatedAt: at,
      });
      return null;
    }
    return { keep: keptWordsOf([input.keep, ...requests.map((item) => item.body.keep)]), mode: input.mode ?? 'manual' };
  });
  const conflict = (threadId: string): Effect.Effect<never, ThreadBorderFailed> =>
    Effect.flatMap(ledger.activeRun(threadId), (active) =>
      Effect.fail(new ThreadCallBroke({ cause: new ThreadRunConflictError({ threadId, runId: active?.id ?? threadId }) })),
    );
  const open = Effect.fnUntraced(function* (
    input: ThreadCompactionRunInput & {
      readonly thread: ThreadRow;
    },
  ): Effect.fn.Return<ThreadCompactionOpened, ThreadBorderFailed> {
    const asked = new Set(input.requests?.ids ?? []);
    const held = yield* Ref.make<readonly ThreadCompactionRequest[]>([]);
    const done = yield* Ref.make<Effect.Effect<void, ThreadBorderFailed>>(Effect.void);
    const entering = yield* Ref.make<ThreadRunRow | null>(null);
    const capability = input.thread.capabilities.compaction;
    const vendor = capability === 'session' && input.summarizing?.kind === 'own';
    const folding: ThreadCompactionRunInput =
      (capability === 'session' || capability === 'foreign' || input.recovery === true) && !vendor
        ? { ...input, releases: handover.restore(input.thread) }
        : input;
    const opened = yield* openings.open(input.thread, {
      kind: 'compaction',
      approval: { mode: 'trust', interactive: false },
      spends: false,
      inherits: false,
      keepsPrompt: true,
      startKey: input.startKey,
      entered: Effect.fnUntraced(function* (run, tx) {
        yield* Ref.set(entering, run);
        for (const values of input.accepting ?? []) yield* inbox.put(values, tx);
        yield* Ref.set(
          held,
          asked.size === 0
            ? []
            : (yield* inbox.pending(input.thread.id, tx)).filter(
                (item): item is ThreadCompactionRequest => asked.has(item.id) && item.state === 'queued' && isCompactionRequest(item),
              ),
        );
        return [threadCompactionEvent(runs.opening(input, run))];
      }),
      consume: (runId, tx) =>
        Effect.flatMap(Ref.get(held), (requests) =>
          requests.length === 0
            ? Effect.void
            : inbox.deliver(
                requests.map((item) => item.id),
                runId,
                tx,
              ),
        ),
      ...(vendor
        ? { compacts: ordered(input, held, entering) }
        : {
            works: Effect.fnUntraced(function* (run: ThreadRunRow) {
              const work =
                capability === 'vendor' && input.recovery !== true
                  ? cannotCompact(input.thread)
                  : yield* runs.work(folding, run, yield* Ref.get(held));
              const tracking = yield* execution.track(run, { work });
              tracking.startTracking();
              yield* Ref.set(done, tracking.done);
            }),
          }),
    });
    switch (opened.status) {
      case 'opened':
        return { run: opened.run, done: vendor ? settled(input.thread.id, opened.run.id) : yield* Ref.get(done) };
      case 'replayed':
        return { run: opened.run, done: Effect.void };
      default:
        return yield* conflict(input.thread.id);
    }
  });
  const summarizing = (
    thread: ThreadRow,
    named: ThreadSummarizerSelection | undefined,
    running: boolean,
  ): Effect.Effect<ThreadSummarizing, ThreadBorderFailed> =>
    compactor.summarizing({
      threadId: thread.id,
      provider: thread.provider,
      model: thread.model,
      running,
      compaction: thread.capabilities.compaction,
      named,
    });
  const cannotCompact = (thread: ThreadRow): Effect.Effect<never, ThreadBorderFailed> =>
    new ThreadCallBroke({
      cause: cannotOn(
        thread,
        'compaction',
        thread.transport.adapter,
        thread.capabilities.compaction === 'vendor'
          ? "The vendor owns this session's compaction and exposes no compaction API; Tagma cannot compact it on request without replacing the session and losing its warm cache."
          : undefined,
      ),
    });
  const foldsAfterTurn = (thread: ThreadRow, named: ThreadSummarizerSelection | undefined): Effect.Effect<boolean, ThreadBorderFailed> =>
    thread.capabilities.compaction === 'foreign'
      ? Effect.succeed(true)
      : thread.capabilities.compaction === 'session'
        ? Effect.map(summarizing(thread, named, true), (summarizing) => summarizing.kind === 'foreign')
        : Effect.succeed(false);
  const reread = (threadId: string): Effect.Effect<ThreadRow, ThreadBorderFailed> =>
    Effect.flatMap(kernel.store.find(threadId), (current) =>
      current === undefined ? new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) }) : Effect.succeed(current),
    );
  const asking = Effect.fnUntraced(function* (
    thread: ThreadRow,
    input: ThreadCompactAsk,
    again: Effect.Effect<ThreadCompactionAsked, ThreadBorderFailed> | null,
  ): Effect.fn.Return<ThreadCompactionAsked, ThreadBorderFailed> {
    const at = input.at === 'step' && (yield* foldsAfterTurn(thread, input.summarizer)) ? 'end' : input.at;
    const words = input.keep === undefined ? {} : { keep: input.keep };
    const named = input.summarizer === undefined ? {} : { summarizer: input.summarizer };
    const now = Effect.gen(function* () {
      const head = compactionHead(yield* inbox.pending(thread.id), input.summarizer);
      const chosen = yield* summarizing(thread, input.summarizer ?? namedSummarizerOf(head), false);
      const durable =
        thread.capabilities.compaction === 'session' &&
        chosen.kind === 'own' &&
        at !== undefined &&
        (input.keep !== undefined || input.mode !== undefined);
      const standing = head.map((item) => item.id);
      const barrier = durable ? inboxCompactionValues(thread.id, { at, mode: input.mode, ...words, ...named }) : null;
      return yield* open({
        thread,
        ...(durable ? {} : words),
        startKey: input.startKey,
        mode: input.mode,
        summarizing: chosen,
        ...(barrier !== null
          ? { accepting: [barrier], requests: { ids: [...standing, barrier.id], alone: false } }
          : head.length > 0
            ? { requests: { ids: standing, alone: false } }
            : {}),
      });
    }).pipe(
      Effect.map((opened): ThreadCompactionAsked => ({ status: 'started', ...opened })),
      Effect.catchCause((cause) =>
        at !== undefined && again !== null && threadCauseOf(Cause.squash(cause)) instanceof ThreadRunConflictError
          ? again
          : Effect.failCause(cause),
      ),
    );
    if (at === undefined) return yield* now;
    const request = inboxCompactionValues(thread.id, { at, mode: input.mode, ...words, ...named });
    const active = yield* ledger.activeRun(thread.id);
    if (active === null) {
      const latest = yield* ledger.latestRun(thread.id);
      const ahead = beforeBarrier(yield* inbox.pending(thread.id));
      if (
        at === 'step' ||
        latest === null ||
        latest.status === 'cut' ||
        !ahead.some((item) => opensTurn(item) || isReaderWordsItem(item))
      ) {
        return yield* now;
      }
      const behind = yield* runInbox.requestBehind(thread.id, request);
      if (behind !== null) {
        yield* snapshots.publish(thread.id);
        return { status: 'requested', request: behind, runId: latest.id } satisfies ThreadCompactionAsked;
      }
      if (again !== null) return yield* again;
      return yield* new ThreadCallBroke({ cause: new ThreadRunConflictError({ threadId: thread.id, runId: latest.id }) });
    }
    const accepted = yield* runInbox.request({ id: active.id, threadId: thread.id }, request, active.kind === 'compaction');
    if (accepted.status === 'joined') return { status: 'joined', runId: active.id } satisfies ThreadCompactionAsked;
    if (accepted.status === 'requested') {
      yield* snapshots.publish(thread.id);
      yield* handover.queued(thread, active);
      return { status: 'requested', request: accepted.item, runId: active.id } satisfies ThreadCompactionAsked;
    }
    if (again !== null) return yield* again;
    return yield* new ThreadCallBroke({ cause: new ThreadRunConflictError({ threadId: thread.id, runId: active.id }) });
  });
  const aheadOf = Effect.fnUntraced(function* (
    thread: ThreadRow,
    keep: string,
    item: ThreadInboxItemValues,
    startKey: ThreadRunStartKey | undefined,
    again: Effect.Effect<ThreadCompactionAhead, ThreadBorderFailed> | null,
  ): Effect.fn.Return<ThreadCompactionAhead, ThreadBorderFailed> {
    const barrier = inboxCompactionValues(thread.id, { at: 'end', keep }, barrierIdAhead(item));
    const behind = behindBarrier(barrier, item);
    const answered = (runId: string | null, started: boolean): ThreadCompactionAhead => ({
      requestId: barrier.id,
      itemId: behind.id,
      runId,
      started,
    });
    if ((yield* ledger.activeRun(thread.id)) === null) {
      const pending = yield* inbox.pending(thread.id);
      if (compactsNow(yield* ledger.latestRun(thread.id), pending)) {
        const head = compactionHead(pending);
        const opened = yield* open({
          thread,
          summarizing: yield* summarizing(thread, namedSummarizerOf(head), false),
          accepting: [barrier, behind],
          requests: { ids: [...head.map((each) => each.id), barrier.id], alone: true },
          startKey: startKey,
        }).pipe(
          Effect.map((started) => started.run.id),
          Effect.catchCause((cause) =>
            threadCauseOf(Cause.squash(cause)) instanceof ThreadRunConflictError ? Effect.succeed(null) : Effect.failCause(cause),
          ),
        );
        if (opened !== null) return answered(opened, true);
      }
    }
    const queued: {
      road: 'accepted' | 'idle' | 'gone';
      runId: string | null;
    } = { road: 'gone', runId: null };
    yield* controlIfPresent<undefined, ThreadWriteTx>(
      kernel,
      thread.id,
      {
        decide: Effect.fnUntraced(function* (_row, tx) {
          const running = yield* ledger.latestRun(thread.id, ['running'], tx);
          const latest = running ?? (yield* ledger.latestRun(thread.id, undefined, tx));
          queued.runId = latest?.id ?? null;
          if (running === null && compactsNow(latest, yield* inbox.pending(thread.id, tx))) {
            queued.road = 'idle';
            return { refuse: undefined } as Decision<undefined, ThreadWriteTx>;
          }
          queued.road = 'accepted';
          return {
            apply: true,
            result: undefined,
            participants: Effect.fnUntraced(function* (unit) {
              yield* inbox.put(barrier, unit);
              yield* inbox.put(behind, unit);
            }),
          } as Decision<undefined, ThreadWriteTx>;
        }),
      },
      { evidence: { inboxItem: barrier.id, run: null }, digest: actDigest(['ask-ahead', barrier.id, behind.id]) },
    );
    if (queued.road === 'accepted') {
      yield* snapshots.publish(thread.id);
      return answered(queued.runId, false);
    }
    if (queued.road === 'gone') return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${thread.id}.`) });
    if (again !== null) return yield* again;
    return yield* new ThreadCallBroke({ cause: new ThreadRunConflictError({ threadId: thread.id, runId: queued.runId ?? thread.id }) });
  });
  return {
    recover: Effect.fn('Compactions.recover')(function* (
      thread: ThreadMetadataRow,
      runId: string,
    ): Effect.fn.Return<boolean, ThreadBorderFailed> {
      if (thread.capabilities.compaction !== 'vendor') return false;
      const threadId = thread.id;
      const run = yield* ledger.latestRun(threadId);
      if (run === null || run.id !== runId || run.kind !== 'turn' || (run.status !== 'failed' && run.status !== 'completed')) return false;
      const reading = thread.contextReading;
      const exhausted =
        reading !== null &&
        !reading.stale &&
        reading.runId === run.id &&
        reading.contextWindow !== null &&
        reading.contextWindow > 0 &&
        reading.usage.inputTokens !== undefined &&
        reading.usage.outputTokens !== undefined &&
        reading.usage.inputTokens + reading.usage.outputTokens >= reading.contextWindow;
      if (run.failure?.contextOverflow !== true && !exhausted) return false;
      const repeated = (yield* inbox.delivered(threadId, run.id)).some((id) => id.startsWith('context-recovery:'));
      if (repeated) return false;
      const row = yield* kernel.store.find(threadId);
      if (row === undefined) return false;
      const continuing =
        run.status === 'failed'
          ? inboxSignalValues(threadId, {
              id: `context-recovery:${run.id}`,
              type: 'context-recovery',
              addressee: 'transport',
              text: 'The vendor exhausted its context. The thread was compacted into a fresh session; continue the outstanding work from its recorded history without repeating completed tool effects.',
              occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            })
          : null;
      yield* open({
        thread: row,
        mode: 'automatic',
        recovery: true,
        continuation: continuing ?? undefined,
      });
      return true;
    }),
    ended: (runId: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        const waiting = waits.get(runId);
        waits.delete(runId);
        return waiting === undefined ? Effect.void : Deferred.succeed(waiting, undefined);
      }),
    queued: Effect.fnUntraced(
      function* (
        thread: ThreadRow,
        head: readonly ThreadCompactionRequest[],
      ): Effect.fn.Return<ThreadCompactionOpened, ThreadBorderFailed> {
        const requests = head.length > 0 ? { ids: head.map((item) => item.id), alone: true } : undefined;
        const mode = head.length > 0 && head.every((item) => item.body.mode === 'automatic') ? 'automatic' : 'manual';
        if (thread.capabilities.compaction === 'core' || thread.capabilities.compaction === 'vendor')
          return yield* open({ thread, requests, mode });
        const resolved = yield* summarizing(thread, namedSummarizerOf(head), false).pipe(
          Effect.matchEffect({
            onSuccess: (summarizing) => open({ thread, requests, mode, summarizing }),
            onFailure: (failure) => (failure instanceof ThreadNoSummarizerError ? open({ thread, requests, mode }) : Effect.fail(failure)),
          }),
        );
        return resolved;
      },
      Effect.as(true),
      Effect.catchCause((cause) =>
        threadCauseOf(Cause.squash(cause)) instanceof ThreadRunConflictError ? Effect.succeed(false) : Effect.failCause(cause),
      ),
    ),
    ask: (thread: ThreadRow, input: ThreadCompactAsk): Effect.Effect<ThreadCompactionAsked, ThreadBorderFailed> =>
      thread.capabilities.compaction === 'none' || thread.capabilities.compaction === 'vendor'
        ? cannotCompact(thread)
        : racing(
            thread,
            (current, again) => asking(current, input, again),
            (current) => reread(current.id),
          ),
    ahead: (
      thread: ThreadRow,
      keep: string,
      item: ThreadInboxItemValues,
      startKey?: ThreadRunStartKey,
    ): Effect.Effect<ThreadCompactionAhead, ThreadBorderFailed> =>
      thread.capabilities.compaction === 'none' || thread.capabilities.compaction === 'vendor'
        ? cannotCompact(thread)
        : racing(
            thread,
            (current, again) => aheadOf(current, keep, item, startKey, again),
            (current) => reread(current.id),
          ),
  };
});
