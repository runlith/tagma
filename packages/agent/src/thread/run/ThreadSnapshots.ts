import { Cause, Clock, Context, Duration, Effect, FiberMap, Layer, References, Tracer } from 'effect';
import { producerCost } from '@runlith/performance/CostLedger';
import { declare, type Held } from '@runlith/held/Held';
import type { ThreadPendingInput, ThreadQueuedTurn, ThreadResumeOf, ThreadWaitingTurn, WordsWait } from '../../transcript/live';
import type { ThreadSnapshot, ThreadState } from '../state';
import { WIRE_PAGE_MAX_BYTES, WIRE_PAGE_MAX_ENTRIES } from '../../transcript/cap';
import { extendPageToTurnRoot } from '../../transcript/page';
import { threadWireDeltas } from '../ThreadWireDeltas';
import type { ThreadInboxItem } from '../storage/inbox';
import type { ThreadMetadataRow, ThreadRunRow } from '../rows';
import type { ThreadTranscriptPage } from '../../transcript/rows';
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
import { RunEndings } from './lifecycle/endings';
import { LaunchGate } from './LaunchGate';
import { openQuestionsOf } from './openQuestions';
import { decodeRecord } from './scheduler/answers';
import { ThreadRunLedger } from './ThreadRunLedger';
import { WordsInFlight } from './WordsInFlight';
import { Transports } from '../transport/Transports';
import { wordsWaitOf, type WordsWaitOwners } from './wordsWait';
import { ThreadEntryKinds } from '../../transcript/kinds';
export class ThreadSnapshots extends Context.Service<
  ThreadSnapshots,
  {
    state(threadId: string): Effect.Effect<ThreadState, ThreadBorderFailed>;
    snapshot(threadId: string): Effect.Effect<ThreadSnapshot, ThreadBorderFailed>;
    attachFrom(threadId: string, sincePosition: number): Effect.Effect<ThreadResumeOf<ThreadState> | null, ThreadBorderFailed>;
    page(threadId: string, before: number): Effect.Effect<ThreadTranscriptPage, ThreadBorderFailed>;
    publish(threadId: string): Effect.Effect<void, ThreadBorderFailed>;
    statuses(ownerId: string, threadIds: readonly string[]): Effect.Effect<readonly StatusRow[], ThreadBorderFailed>;
    forget(threadIds: readonly string[]): Effect.Effect<void>;
  }
>()('@runlith/agent/ThreadSnapshots') {}
type SnapshotReading = { readonly state: ThreadState; readonly changesAt: Date | null };

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
    return { state: { thread, position, activeRun, latestRun, pendingInput, status, now: now.toISOString() }, changesAt };
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
      const current = yield* state(threadId);
      return { current, value: yield* read(current) };
    });
    return yield* feed.atCut(
      threadId,
      Effect.gen(function* () {
        const first = yield* once();
        const still = (yield* journal.headPosition(threadId)) === first.current.position;
        if (!still) yield* Effect.annotateCurrentSpan({ writersHeld: true });
        const { current, value } = still ? first : yield* store.transaction(() => once());
        if (!published.has(threadId)) published.set(threadId, current.position);
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
  const inLane = (threadId: string, work: Effect.Effect<void, ThreadBorderFailed>): Effect.Effect<void, ThreadBorderFailed> =>
    lanes
      .hold(threadId, work)
      .pipe(Effect.mapError((failure) => (isThreadBorderFailure(failure) ? failure : new ThreadCallBroke({ cause: failure }))));
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
          }),
        ),
      { discard: true },
    );
  const publish = (threadId: string): Effect.Effect<void, ThreadBorderFailed> =>
    producerCost(PUBLISHING, residence === null ? framed(threadId) : residence.reading(threadId, framed(threadId)));
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
            yield* feed.publish({ state: current, from, deltas: deltas ?? [] });
            return read;
          }),
        );
        yield* arm(threadId, read.state.status, read.changesAt);
      }).pipe(Effect.withSpan(PUBLISHING, { attributes: { threadId } })),
    );
  return ThreadSnapshots.of({ state, snapshot, attachFrom, page, publish, statuses, forget });
});

export const threadSnapshotsLayer = Layer.effect(ThreadSnapshots, makeThreadSnapshots);

export const PUBLISHING = 'ThreadSnapshots.publish';
export const READING = 'ThreadSnapshots.reading';
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
