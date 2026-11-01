import { Cause, Clock, Context, Duration, Effect, FiberMap, FiberSet, Layer, References, Tracer } from 'effect';
import { CurrentCost, producerCost, type CostCause } from '@runlith/performance/CostLedger';
import { declare, type Held } from '@runlith/held/Held';
import type { ThreadPendingInput, ThreadQueuedTurn, ThreadResumeOf, ThreadWaitingTurn, WordsWait } from '../../transcript/live';
import type { ThreadRunChange, ThreadSnapshot, ThreadState, ThreadStateChange } from '../state';
import { WIRE_PAGE_MAX_BYTES, WIRE_PAGE_MAX_ENTRIES } from '../../transcript/cap';
import { extendPageToTurnRoot } from '../../transcript/page';
import { coreEntry } from '../../transcript/kinds';
import { threadWireDeltas } from '../ThreadWireDeltas';
import type { ThreadInboxItem } from '../storage/inbox';
import type { ThreadMetadataRow, ThreadRunRow } from '../rows';
import type { ThreadTranscriptPage } from '../../transcript/rows';
import type { ThreadEventRecord } from '../events';
import { threadEventFact } from '../ThreadEventDoor';
import {
  carriesWords,
  isEndBarrier,
  isReaderWordsItem,
  isStepRequest,
  isUnreadSteer,
  opensTurn,
  threadQueuedTurnOf,
  threadSignalOfInboxItem,
  waitsForTurn,
} from '../inboxItems';
import { threadSignalArrival } from '../events';
import {
  ThreadAttachments,
  ThreadEventJournal,
  ThreadFeed,
  ThreadLeaseRhythm,
  ThreadInbox,
  ThreadResidence,
  ThreadResting,
  ThreadStore,
  ThreadTransitions,
} from '../ThreadPorts';
import type { RunStatus, StatusRow } from '../../transcript/live';
import { inputAddressOf } from '../keyed';
import { recordedReceiptOf, runStatusOf, type RecordedReceipt } from './runStatusOf';
import { ThreadCallBroke, isThreadBorderFailure, type ThreadBorderFailed } from '../ThreadBorder';
import { RunEndings, type RunEnding } from './lifecycle/endings';
import { LaunchGate } from './LaunchGate';
import { ThreadChanges } from './ThreadChanges';
import { openQuestionsOf } from './openQuestions';
import { decodeRecord } from './scheduler/answers';
import { ThreadRunLedger } from './ThreadRunLedger';
import { WordsInFlight } from './WordsInFlight';
import { Transports } from '../transport/Transports';
import { wordsWaitOf, type WordsWaitOwners } from './wordsWait';
import { ThreadEntryKinds } from '../../transcript/kinds';
import { awaitsAnswer } from '../state';
export class ThreadSnapshots extends Context.Service<
  ThreadSnapshots,
  {
    state(threadId: string): Effect.Effect<ThreadState, ThreadBorderFailed>;
    snapshot(threadId: string): Effect.Effect<ThreadSnapshot, ThreadBorderFailed>;
    attachFrom(threadId: string, sincePosition: number): Effect.Effect<ThreadResumeOf<ThreadState> | null, ThreadBorderFailed>;
    page(threadId: string, before: number): Effect.Effect<ThreadTranscriptPage, ThreadBorderFailed>;
    publish(threadId: string): Effect.Effect<void, ThreadBorderFailed>;
    committed(change: ThreadStateChange): Effect.Effect<void>;
    statuses(ownerId: string, threadIds: readonly string[]): Effect.Effect<readonly StatusRow[], ThreadBorderFailed>;
    forget(threadIds: readonly string[]): Effect.Effect<void>;
  }
>()('@runlith/agent/ThreadSnapshots') {}
type StatusInputs = {
  readonly recorded: ReadonlyMap<string, RecordedReceipt>;
  readonly openQuestions: readonly string[];
  readonly ended: RunEnding | null;
};
type SnapshotReading = {
  readonly state: ThreadState;
  readonly revision: number;
  readonly changesAt: Date | null;
  readonly inputs: StatusInputs;
};
type Projection = { readonly state: ThreadState; readonly revision: number; readonly inputs: StatusInputs };
type Appended = Extract<ThreadStateChange, { readonly kind: 'appended' }>;
type Ran = Extract<ThreadStateChange, { readonly kind: 'ran' }>;
type Asked = { readonly cause: CostCause | null; readonly parent: Tracer.AnySpan | null };
type Work = Asked & { readonly change: ThreadStateChange };
const HELD_PROJECTIONS = 256;
const QUEUED_CHANGES = 64;

export const makeThreadSnapshots = Effect.gen(function* () {
  const journal = yield* ThreadEventJournal;
  const kinds = yield* ThreadEntryKinds;
  const feed = yield* ThreadFeed;
  const lease = yield* ThreadLeaseRhythm;
  const inbox = yield* ThreadInbox;
  const attachments = yield* ThreadAttachments;
  const ledger = yield* ThreadRunLedger;
  const endings = yield* RunEndings;
  const gate = yield* LaunchGate;
  const store = yield* ThreadStore;
  const transitions = yield* ThreadTransitions;
  const residence = yield* ThreadResidence;
  const owners: WordsWaitOwners = { resting: yield* ThreadResting, gate, inflight: yield* WordsInFlight };
  const transports = yield* Transports;
  const waitOf = (
    thread: ThreadMetadataRow,
    activeRun: ThreadRunRow | null,
    latestRun: ThreadRunRow | null,
    waiting: readonly ThreadInboxItem[],
  ): Effect.Effect<WordsWait | null, ThreadBorderFailed> =>
    activeRun !== null || waiting.some((item) => item.state === 'queued' && carriesWords(item) && !waitsForTurn(item))
      ? wordsWaitOf(owners, transports, thread, { active: activeRun !== null, after: latestRun?.id ?? null })
      : Effect.succeed(null);
  const published = new Map<string, number>();
  const framedAt = new Map<string, number>();
  const ahead = new Map<string, number>();
  const projections = new Map<string, Projection>();
  const queues = new Map<string, Work[]>();
  const draining = yield* FiberSet.make<void>();
  const lifetime = yield* Effect.context<never>();
  const deadlines = yield* FiberMap.make<string>();
  const reconsiderations = yield* FiberMap.make<string, void, ThreadBorderFailed>();
  const shown = new Map<string, string>();
  const lanes: Held<string> = declare<string>({
    name: 'agent-snapshot-lane',
    owner: 'agent',
    rank: 241,
    key: (key: string) => key,
    concurrency: 1,
    threshold: Duration.seconds(10),
    ceilings: {
      hold: Duration.seconds(60),
      wait: Duration.seconds(60),
      leaves: 'the state frame may already be published; read its revision before retrying',
    },
    external: 'none',
  });
  const recordedOf = (
    threadId: string,
    pending: ThreadPendingInput,
  ): Effect.Effect<ReadonlyMap<string, RecordedReceipt>, ThreadBorderFailed> =>
    Effect.map(
      Effect.forEach([...pending.queued, ...pending.steers], (turn) => {
        const address = inputAddressOf(turn.id);
        if (address === null) return Effect.succeed(null);
        return Effect.map(transitions.readRecord(threadId, address.evidence), (record) =>
          record.kind === 'present' ? recordedReceiptOf(address.key, decodeRecord(record.result)) : null,
        ).pipe(Effect.map((receipt) => (receipt === null ? null : ([turn.id, receipt] as const))));
      }),
      (rows) => new Map(rows.filter((row) => row !== null)),
    );
  const reading = Effect.fn(READING)(function* (threadId: string): Effect.fn.Return<SnapshotReading, ThreadBorderFailed> {
    const revision = yield* transitions.revision(threadId);
    const position = yield* journal.headPosition(threadId);
    const thread = yield* store.metadata(threadId);
    if (!thread) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });
    const [activeRun, latestRun] = yield* Effect.all([ledger.activeRun(threadId), ledger.latestRun(threadId)], {
      concurrency: 'unbounded',
    });
    const waiting = yield* inbox.pending(threadId);
    const pendingInput = yield* pendingInputOf(attachments, thread, holdingOf(activeRun, latestRun, waiting)?.id ?? null, waiting);
    const recorded = yield* recordedOf(threadId, pendingInput);
    const openQuestions = (yield* openQuestionsOf(store, threadId, activeRun)).map((question) => question.questionId);
    const now = new Date(yield* Clock.currentTimeMillis);
    const ended = activeRun === null ? ((yield* endings.newest([threadId], 1))[0] ?? null) : null;
    const launchBlocked = gate.blocked(threadId);
    const wordsWait = yield* waitOf(thread, activeRun, latestRun, waiting);
    const { status, changesAt } = runStatusOf(
      { thread, activeRun, pendingInput, openQuestions, recorded, launchBlocked, wordsWait },
      now,
      lease,
      ended,
    );
    return {
      state: { thread, position, activeRun, latestRun, pendingInput, status, now: now.toISOString() },
      revision,
      changesAt,
      inputs: { recorded, openQuestions, ended },
    };
  });
  const state = (threadId: string): Effect.Effect<ThreadState, ThreadBorderFailed> => Effect.map(reading(threadId), (read) => read.state);
  const statuses = Effect.fn('ThreadSnapshots.statuses')(function* (
    ownerId: string,
    threadIds: readonly string[],
  ): Effect.fn.Return<readonly StatusRow[], ThreadBorderFailed> {
    const threads = new Map((yield* store.metadataOf(threadIds)).map((thread) => [thread.id, thread]));
    const owned = threadIds.filter((threadId) => threads.get(threadId)?.ownerId === ownerId);
    const running = new Map((yield* ledger.runningOf(owned)).map((run) => [run.threadId, run]));
    const pending = yield* inbox.pendingOf(owned);
    const now = new Date(yield* Clock.currentTimeMillis);
    const read = yield* Effect.forEach(
      threadIds,
      Effect.fnUntraced(function* (threadId) {
        const thread = threads.get(threadId);
        if (!thread) return { threadId, outcome: 'not-found' as const };
        if (thread.ownerId !== ownerId) return { threadId, outcome: 'foreign-owner' as const };
        const activeRun = running.get(threadId) ?? null;
        const waiting = pending.get(threadId) ?? [];
        const latestRun = activeRun === null && waiting.some((item) => item.state === 'queued') ? yield* ledger.latestRun(threadId) : null;
        const pendingInput = yield* pendingInputOf(attachments, thread, holdingOf(activeRun, latestRun, waiting)?.id ?? null, waiting);
        const recorded = yield* recordedOf(threadId, pendingInput);
        const openQuestions = (yield* openQuestionsOf(store, threadId, activeRun)).map((question) => question.questionId);
        return {
          threadId,
          outcome: 'found' as const,
          thread,
          activeRun,
          pendingInput,
          openQuestions,
          recorded,
          launchBlocked: gate.blocked(threadId),
          wordsWait: yield* waitOf(thread, activeRun, latestRun, waiting),
        };
      }),
      { concurrency: 8 },
    );
    const idle = read.flatMap((row) => (row.outcome === 'found' && row.activeRun === null ? [row.threadId] : []));
    const ended = new Map((yield* endings.newest(idle, 1)).map((ending) => [ending.threadId, ending]));
    return read.map((row): StatusRow => {
      if (row.outcome !== 'found') return row;
      const { status } = runStatusOf(row, now, lease, ended.get(row.threadId) ?? null);
      return { threadId: row.threadId, outcome: 'found', status };
    });
  });
  const window = (threadId: string, before?: number): Effect.Effect<ThreadTranscriptPage, ThreadBorderFailed> =>
    Effect.map(
      store.transcriptWindow(threadId, {
        before: before,
        limit: WIRE_PAGE_MAX_ENTRIES,
        bytes: WIRE_PAGE_MAX_BYTES,
      }),
      (page) => page ?? { entries: [], before: null },
    );
  const readCut = <A>(threadId: string, read: (current: ThreadState) => Effect.Effect<A, ThreadBorderFailed>) =>
    residence === null ? cut(threadId, read) : residence.reading(threadId, cut(threadId, read));
  const cut = Effect.fnUntraced(function* <A>(threadId: string, read: (current: ThreadState) => Effect.Effect<A, ThreadBorderFailed>) {
    const once = Effect.fnUntraced(function* () {
      const { state: current, revision } = yield* reading(threadId);
      return { current, revision, value: yield* read(current) };
    });
    return yield* feed.atCut(
      threadId,
      Effect.gen(function* () {
        const first = yield* once();
        const still = (yield* journal.headPosition(threadId)) === first.current.position;
        if (!still) yield* Effect.annotateCurrentSpan({ writersHeld: true });
        const { current, revision, value } = still ? first : yield* store.transaction(() => once());
        if (!published.has(threadId)) published.set(threadId, current.position);
        ahead.set(threadId, Math.max(ahead.get(threadId) ?? revision, revision));
        const live = feed.view(threadId);
        return { value, live: { ...live, at: { position: current.position, seq: live.at.seq } } };
      }),
    );
  });
  const snapshot = (threadId: string): Effect.Effect<ThreadSnapshot, ThreadBorderFailed> =>
    Effect.map(
      readCut(
        threadId,
        Effect.fnUntraced(function* (current) {
          const newest = yield* window(threadId);
          const walk = yield* extendPageToTurnRoot(newest, (before) => window(threadId, before), {
            entries: WIRE_PAGE_MAX_ENTRIES,
            bytes: WIRE_PAGE_MAX_BYTES,
          });
          yield* Effect.annotateCurrentSpan({ transcriptPages: walk.pages + 1, transcriptStop: walk.stop });
          return { ...current, transcript: walk.page.entries, before: walk.page.before };
        }),
      ),
      ({ value, live }) => {
        const fresher = new Map(live.open.map((entry) => [entry.id, entry]));
        const transcript = value.transcript.map((entry) => {
          const open = fresher.get(entry.id);
          if (open === undefined) return entry;
          fresher.delete(entry.id);
          return open;
        });
        return { ...value, transcript, live: { ...live, open: [...fresher.values()] } };
      },
    ).pipe(Effect.withSpan('ThreadSnapshots.snapshot'));
  const attachFrom = (threadId: string, sincePosition: number): Effect.Effect<ThreadResumeOf<ThreadState> | null, ThreadBorderFailed> =>
    Effect.map(
      readCut(threadId, (current) =>
        Effect.map(threadWireDeltas(journal, kinds, threadId, sincePosition), (deltas) => (deltas ? { state: current, deltas } : null)),
      ),
      ({ value, live }) => (value ? { ...value, live } : null),
    ).pipe(Effect.withSpan('ThreadSnapshots.attachFrom'));
  const page = (threadId: string, before: number): Effect.Effect<ThreadTranscriptPage, ThreadBorderFailed> => window(threadId, before);
  const standing = (status: RunStatus): string => `${status.life}|${status.ownership ?? ''}`;
  const arm = (threadId: string, status: RunStatus, changesAt: Date | null): Effect.Effect<void> =>
    changesAt === null
      ? Effect.suspend(() => {
          shown.delete(threadId);
          return FiberMap.remove(deadlines, threadId);
        })
      : Effect.gen(function* () {
          shown.set(threadId, standing(status));
          const now = yield* Clock.currentTimeMillis;
          const wait = Effect.sleep(Duration.millis(Math.max(0, changesAt.getTime() - now)));
          const armed = FiberMap.run(
            deadlines,
            threadId,
            Effect.andThen(wait, FiberMap.run(reconsiderations, threadId, reconsider(threadId), { onlyIfMissing: true })),
          );
          yield* Effect.updateContext(armed, (context: Context.Context<never>) =>
            Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(context),
          );
        });
  const reconsider = Effect.fnUntraced(
    function* (threadId: string): Effect.fn.Return<void, ThreadBorderFailed> {
      const read = yield* reading(threadId);
      if (shown.get(threadId) !== standing(read.state.status)) return yield* publish(threadId);
      yield* arm(threadId, read.state.status, read.changesAt);
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning('a thread status deadline could not be reconsidered', { threadId, cause }),
        ),
      ),
  );
  const forget = (threadIds: readonly string[]): Effect.Effect<void> =>
    Effect.forEach(
      threadIds,
      (threadId) =>
        Effect.andThen(
          Effect.all([FiberMap.remove(deadlines, threadId), FiberMap.remove(reconsiderations, threadId)]),
          Effect.sync(() => {
            shown.delete(threadId);
            published.delete(threadId);
            framedAt.delete(threadId);
            ahead.delete(threadId);
            queues.delete(threadId);
            projections.delete(threadId);
          }),
        ),
      { discard: true },
    );
  const hold = (threadId: string, projection: Projection): void => {
    projections.delete(threadId);
    projections.set(threadId, projection);
    if (projections.size <= HELD_PROJECTIONS) return;
    const oldest = projections.keys().next().value;
    if (oldest !== undefined) projections.delete(oldest);
  };
  const inLane = <A>(threadId: string, work: Effect.Effect<A, ThreadBorderFailed>): Effect.Effect<A, ThreadBorderFailed> =>
    lanes
      .hold(threadId, work)
      .pipe(Effect.mapError((failure) => (isThreadBorderFailure(failure) ? failure : new ThreadCallBroke({ cause: failure }))));
  const framed = (threadId: string): Effect.Effect<void, ThreadBorderFailed> =>
    inLane(
      threadId,
      Effect.gen(function* () {
        const read = yield* feed.atCut(
          threadId,
          Effect.gen(function* () {
            const read = yield* reading(threadId);
            const current = read.state;
            const from = published.get(threadId) ?? current.position;
            const deltas = from < current.position ? yield* threadWireDeltas(journal, kinds, threadId, from) : [];
            published.set(threadId, Math.max(from, current.position));
            framedAt.set(threadId, Math.max(framedAt.get(threadId) ?? read.revision, read.revision));
            if ((ahead.get(threadId) ?? read.revision) <= read.revision) ahead.delete(threadId);
            yield* feed.publish({ state: current, from, deltas: deltas ?? [] });
            return read;
          }),
        );
        hold(threadId, { state: read.state, revision: read.revision, inputs: read.inputs });
        yield* arm(threadId, read.state.status, read.changesAt);
      }).pipe(
        Effect.onError(() => Effect.sync(() => projections.delete(threadId))),
        Effect.withSpan(PUBLISHING, { attributes: { threadId } }),
      ),
    );
  const publish = (threadId: string): Effect.Effect<void, ThreadBorderFailed> =>
    producerCost(PUBLISHING, residence === null ? framed(threadId) : residence.reading(threadId, framed(threadId)));
  const applying = (threadId: string, change: Appended): Effect.Effect<boolean, ThreadBorderFailed> =>
    inLane(
      threadId,
      Effect.gen(function* () {
        const { revision } = change;
        if (revision.to <= (framedAt.get(threadId) ?? -1)) return true;
        const position = change.from + change.records.length;
        const held = projections.get(threadId);
        const activeRun = patchedRun(held?.state.activeRun ?? null, change.runs);
        if (held === undefined || activeRun === null || held.revision !== revision.from || published.get(threadId) !== change.from)
          return false;
        if (awaitsAnswer(activeRun.progress.stage) || !change.records.every(plainEntry)) return false;
        const latestRun = patchedRun(held.state.latestRun, change.runs);
        const now = new Date(yield* Clock.currentTimeMillis);
        const thread = { ...held.state.thread, ...change.thread };
        const wordsWait = yield* wordsWaitOf(owners, transports, thread, { active: true, after: latestRun?.id ?? null });
        const { status, changesAt } = runStatusOf(
          {
            thread,
            activeRun,
            pendingInput: held.state.pendingInput,
            openQuestions: held.inputs.openQuestions,
            recorded: held.inputs.recorded,
            launchBlocked: gate.blocked(threadId),
            wordsWait,
          },
          now,
          lease,
          held.inputs.ended,
        );
        const next: ThreadState = { ...held.state, thread, position, activeRun, latestRun, status, now: now.toISOString() };
        const carried = yield* feed.atCut(
          threadId,
          Effect.suspend(() => {
            const current = projections.get(threadId) === held && published.get(threadId) === change.from;
            if (!current || (ahead.get(threadId) ?? revision.from) > revision.from) return Effect.succeed(false);
            published.set(threadId, position);
            framedAt.set(threadId, revision.to);
            if ((ahead.get(threadId) ?? revision.to) <= revision.to) ahead.delete(threadId);
            return Effect.as(
              feed.carry({
                state: next,
                from: change.from,
                deltas: change.records.map((record) => ({ position: record.position, ...threadEventFact(record) })),
              }),
              true,
            );
          }),
        );
        if (!carried) return false;
        if (projections.get(threadId) === held) hold(threadId, { state: next, revision: revision.to, inputs: held.inputs });
        yield* arm(threadId, status, changesAt);
        return true;
      }),
    );
  const ran = (threadId: string, change: Ran): Effect.Effect<void, ThreadBorderFailed> =>
    inLane(
      threadId,
      Effect.gen(function* () {
        const { revision } = change;
        const held = projections.get(threadId);
        if (held === undefined || revision.to <= held.revision) return;
        if (held.revision !== revision.from) return void projections.delete(threadId);
        const activeRun = patchedRun(held.state.activeRun, change.runs);
        const latestRun = patchedRun(held.state.latestRun, change.runs);
        if (activeRun === null || (activeRun === held.state.activeRun && latestRun === held.state.latestRun))
          return hold(threadId, { ...held, state: { ...held.state, latestRun }, revision: revision.to });
        const now = new Date(yield* Clock.currentTimeMillis);
        const wordsWait = yield* wordsWaitOf(owners, transports, held.state.thread, { active: true, after: latestRun?.id ?? null });
        const { status, changesAt } = runStatusOf(
          {
            thread: held.state.thread,
            activeRun,
            pendingInput: held.state.pendingInput,
            openQuestions: held.inputs.openQuestions,
            recorded: held.inputs.recorded,
            launchBlocked: gate.blocked(threadId),
            wordsWait,
          },
          now,
          lease,
          held.inputs.ended,
        );
        const next: ThreadState = { ...held.state, activeRun, latestRun, status, now: now.toISOString() };
        if (standing(status) !== standing(held.state.status)) {
          const carried = yield* feed.atCut(
            threadId,
            Effect.suspend(() => {
              if (projections.get(threadId) !== held || (ahead.get(threadId) ?? revision.from) > revision.from)
                return Effect.succeed(false);
              framedAt.set(threadId, revision.to);
              return Effect.as(feed.carry({ state: next, from: next.position, deltas: [] }), true);
            }),
          );
          if (!carried) return void projections.delete(threadId);
        }
        if (projections.get(threadId) === held) hold(threadId, { state: next, revision: revision.to, inputs: held.inputs });
        yield* arm(threadId, status, changesAt);
      }),
    );
  const asked = <A, E>(work: Effect.Effect<A, E>, by: Asked): Effect.Effect<A, E> =>
    Effect.provideService(by.parent === null ? work : Effect.withParentSpan(work, by.parent), CurrentCost, by.cause);
  const drain = Effect.fnUntraced(function* (threadId: string, queue: Work[]) {
    for (;;) {
      const next = queues.get(threadId) === queue ? queue.shift() : undefined;
      if (next === undefined) {
        if (queues.get(threadId) === queue) queues.delete(threadId);
        return;
      }
      if (next.change.kind === 'ran') {
        const kept = yield* asked(Effect.exit(producerCost(PUBLISHING, ran(threadId, next.change))), next);
        if (kept._tag === 'Failure') {
          projections.delete(threadId);
          if (!Cause.hasInterruptsOnly(kept.cause))
            yield* Effect.logWarning('a heartbeat could not be applied, so the next change reads the thread', {
              threadId,
              cause: kept.cause,
            });
        }
        continue;
      }
      const applied =
        next.change.kind === 'appended' ? yield* asked(Effect.exit(producerCost(PUBLISHING, applying(threadId, next.change))), next) : null;
      if (applied !== null && applied._tag === 'Success' && applied.value) continue;
      if (applied !== null && applied._tag === 'Failure' && !Cause.hasInterruptsOnly(applied.cause))
        yield* Effect.logWarning('a committed change could not be applied, so the thread is read again', {
          threadId,
          cause: applied.cause,
        });
      queue.splice(0);
      const read = yield* asked(Effect.exit(publish(threadId)), next);
      if (read._tag === 'Failure' && !Cause.hasInterruptsOnly(read.cause))
        yield* Effect.logWarning('a thread state could not be published', { threadId, cause: read.cause });
    }
  });
  const asking: Effect.Effect<Asked> = Effect.withFiber((fiber) =>
    Effect.succeed({
      cause: Context.get(fiber.context, CurrentCost),
      parent: Context.getOrUndefined(fiber.context, Tracer.ParentSpan) ?? null,
    }),
  );
  const committed = (change: ThreadStateChange): Effect.Effect<void> =>
    Effect.flatMap(asking, (by) =>
      Effect.suspend(() => {
        const queue = queues.get(change.threadId);
        if (queue !== undefined) {
          if (queue.at(-1)?.change.kind === 'moved') return Effect.void;
          if (queue.length < QUEUED_CHANGES) queue.push({ ...by, change });
          else queue.splice(0, queue.length, { ...by, change: { kind: 'moved', threadId: change.threadId } });
          return Effect.void;
        }
        const started: Work[] = [{ ...by, change }];
        queues.set(change.threadId, started);
        return Effect.asVoid(
          FiberSet.run(draining, Effect.provideContext(drain(change.threadId, started), lifetime), { startImmediately: false }),
        );
      }),
    );
  (yield* ThreadChanges).project(committed);
  return ThreadSnapshots.of({ state, snapshot, attachFrom, page, publish, committed, statuses, forget });
});

export const threadSnapshotsLayer = Layer.effect(ThreadSnapshots, makeThreadSnapshots);

function patchedRun(run: ThreadRunRow | null, changes: readonly ThreadRunChange[] | undefined): ThreadRunRow | null {
  const patch = run === null ? undefined : changes?.find((change) => change.id === run.id);
  if (run === null || patch === undefined) return run;
  const { id: _id, ...fields } = patch;
  return { ...run, ...fields };
}
export const PUBLISHING = 'ThreadSnapshots.publish';
export const READING = 'ThreadSnapshots.reading';
function plainEntry(record: ThreadEventRecord): boolean {
  const { entry, withdrawn, rewound, restored, branched } = record.payload;
  if (withdrawn !== undefined || rewound !== undefined || restored !== undefined || branched !== undefined) return false;
  return entry === undefined || !coreEntry(entry) || entry.type !== 'question';
}
function holdingOf(
  activeRun: ThreadRunRow | null,
  latestRun: ThreadRunRow | null,
  waiting: readonly ThreadInboxItem[],
): ThreadRunRow | null {
  return activeRun ?? (latestRun?.status === 'cut' || waiting.some((item) => item.state === 'queued') ? latestRun : null);
}
function pendingInputOf(
  attachments: Context.Service.Shape<typeof ThreadAttachments>,
  thread: ThreadMetadataRow,
  runId: string | null,
  items: readonly ThreadInboxItem[],
): Effect.Effect<ThreadPendingInput, ThreadBorderFailed> {
  const waiting = items.filter((item) => item.state === 'queued');
  const arriving = waiting.filter(carriesWords).filter((item) => !isReaderWordsItem(item) && !opensTurn(item));
  const arrived = Effect.forEach(arriving, (item) => {
    const signal = threadSignalOfInboxItem(item);
    return signal.attachments?.length
      ? Effect.map(attachments.resolve(thread.id, thread.ownerId, signal.attachments), (stored) =>
          threadSignalArrival(signal, runId, stored),
        )
      : Effect.succeed(threadSignalArrival(signal, runId));
  });
  if (runId === null) return Effect.map(arrived, (arrived) => ({ queued: [], steers: [], arrived }));
  const shown = (item: ThreadInboxItem) => waitingTurnOf(attachments, thread.id, threadQueuedTurnOf(runId, item));
  return Effect.all({
    queued: Effect.forEach(
      waiting.filter((item) => opensTurn(item) || isEndBarrier(item)),
      shown,
    ),
    steers: Effect.forEach(
      waiting.filter((item) => isUnreadSteer(item) || isStepRequest(item)),
      shown,
    ),
    arrived,
  });
}
function waitingTurnOf(
  attachments: Context.Service.Shape<typeof ThreadAttachments>,
  threadId: string,
  turn: ThreadQueuedTurn,
): Effect.Effect<ThreadWaitingTurn, ThreadBorderFailed> {
  const refs = turn.attachments;
  if (refs === undefined) return Effect.succeed({ ...turn, attachments: undefined });
  return Effect.map(attachments.addressed(threadId, refs), (held) => ({
    ...turn,
    attachments: held.map((one) => ({ id: one.id, mime: one.mediaType, url: one.url, filename: one.filename })),
  }));
}
