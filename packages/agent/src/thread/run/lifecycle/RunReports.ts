import { Cause, Clock, Context, Data, Effect, Layer } from 'effect';
import type { Usage } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import type { AgentApproval } from '../../../agent/contracts';
import type { FinishReason } from '@runlith/llm/schema/ids';
import type { WireFailureFamily } from '@runlith/llm/schema/errors';
import type { PartialJsonState } from '@runlith/utils/json';
import type { ToolDisplay } from '../../../tool/display';
import { retryEntryId } from '../../../transcript/entryNames';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../../transcript/rows';
import { unsuccessfulFinish } from '../../../agent/finish';
import { toolSettled, type ThreadQuestionEntry, type ThreadRetryEntry, type TransportFailure } from '../../../transcript/entries';
import { TransportFailed } from '../../ThreadFailure';
import type { ThreadRunStoppedBy } from '../../ending';
import {
  readThreadRunStepsTaken,
  type ThreadEventBody,
  type ThreadStepContext,
  threadEntryEvent,
  threadQuestionEvent,
  threadStepFinishedEvent,
} from '../../events';
import { mintThreadRunId } from '../../identity';
import { isInboxRequest } from '../../inboxItems';
import { actDigest, chargeKey, reportKey, type CallKey } from '../../keyed';
import type { ThreadContextReading, ThreadMetadataRow, ThreadRunCost } from '../../rows';
import { ThreadNotFoundError } from '../../storage/aggregate';
import { THREAD_REQUEST_REQUESTER_GONE, type ThreadInboxItem, type ThreadWordFate } from '../../storage/inbox';
import type { ThreadRunStartFrom } from '../../storage/runs';
import type { ThreadPortFailure } from '../../ThreadBorder';
import { sealThreadEvents } from '../../ThreadEventDoor';
import {
  ThreadAttachments,
  ThreadFeed,
  ThreadInbox,
  ThreadOwner,
  ThreadRunStoreFactory,
  ThreadStore,
  ThreadStreamRhythm,
  type ThreadWriteTx,
} from '../../ThreadPorts';
import { coreEntry, generatedEntry } from '../../../transcript/kinds';
import { answerOf, prepareTransition, transitionDeps, transitionIn } from '../../transition/kernel';
import type { Decision, TransitionPlan } from '../../transition/port';
import { LaunchGate } from '../LaunchGate';
import { RunControl } from '../RunControl';
import { RunBoundaries } from '../RunBoundaries';
import { RunRequests } from '../requests';
import { RunProgress } from '../RunProgress';
import type { AgentPhase, AgentWaiting } from '../../../agent/AgentPhase';
import { endedWhileOpen, routedEntry, withoutAnswers } from '../routedQuestions';
import { routedChange } from '../RoutedTransition';
import type { ThreadRunRef } from '../ThreadRunLedger';
import { WordsInFlight } from '../WordsInFlight';
import { SenderWakes } from '../SenderWakes';
import { ThreadChanges } from '../ThreadChanges';
import { wordsOnly } from './closing';
import { RunLifecycle } from './RunLifecycle';
import { readSignals } from './readSignals';
import { RunTails, type TailDelta } from './runTails';
import { readingAfter } from './contextReading';
export class ForeignBinding extends Data.TaggedError('ForeignBinding')<{
  readonly threadId: string;
  readonly adapter: string;
}> {
  override get message(): string {
    return `Thread ${this.threadId} is not bound to transport ${this.adapter}.`;
  }
}
export class OpeningsRefused extends Data.TaggedError('OpeningsRefused')<{
  readonly threadId: string;
  readonly adapter: string;
}> {
  override get message(): string {
    return `Transport ${this.adapter} opens no turn on thread ${this.threadId} without the core.`;
  }
}
export type RunEnding =
  | {
      readonly kind: 'completed';
      readonly unobserved?: true;
      readonly finish?: FinishReason;
    }
  | {
      readonly kind: 'failed';
      readonly reason: string;
      readonly cause?: TransportFailure;
      //! Returning launch words requires the adapter's refusal first in the same batch.
      readonly launch?: true;
    }
  | {
      readonly kind: 'aborted';
      readonly stoppedBy: ThreadRunStoppedBy | null;
    };
export type ObservedTurn = {
  readonly displaces: string | null;
  readonly approval: AgentApproval;
  readonly entries: (runId: string) => readonly ThreadEventBody[];
};
export type ReportResult = {
  readonly status: 'applied' | 'replayed' | 'settled' | 'unowned' | 'left';
  readonly runId: string;
};
export type ReportTable = 'thread' | 'events' | 'runs' | 'inbox' | 'records' | 'endings' | 'outbox';
export type ReportFailure = ThreadPortFailure | ForeignBinding | OpeningsRefused;
export type ReportPlan = {
  readonly tables: readonly ReportTable[];
  readonly run: (tx: ThreadWriteTx) => Effect.Effect<ReportResult, ReportFailure>;
};
export type RecordedEntries = readonly ThreadEventBody[] | ((history: readonly Message[]) => readonly ThreadEventBody[]);
export type ContextReport =
  | {
      readonly kind: 'measured';
      readonly reading: ThreadContextReading;
    }
  | {
      readonly kind: 'compacted';
      readonly tokens: number;
      readonly measuredAt: string;
    }
  | {
      readonly kind: 'stale';
    };
export type RecordedOptions = {
  readonly reading?: ContextReport;
  readonly unconfirming?: true;
};
export type LiveDelta = TailDelta | { readonly op: 'phase'; readonly phase: AgentPhase['phase'] | null; readonly waiting?: AgentWaiting };
export type MeasuredRequest = {
  readonly usage: Usage;
  readonly attempt: number;
  readonly reading?: ThreadContextReading;
};
export type AdapterDisplay = (threadId: string, name: string, reading: PartialJsonState) => ToolDisplay | undefined;
export type AdapterOptions = { readonly display?: AdapterDisplay };
export type RetriedRequest = {
  readonly attempt: number;
  readonly of: number;
  readonly family: WireFailureFamily;
  readonly delayMs: number;
  readonly status?: number;
  readonly message?: string;
};
export type RunSpend = { readonly rest?: Usage; readonly cost?: ThreadRunCost };
export type AdapterReports = {
  recorded(run: ThreadRunRef, entries: RecordedEntries, evidence: string, options?: RecordedOptions): ReportPlan;
  measured(run: ThreadRunRef, request: MeasuredRequest, evidence: string): ReportPlan;
  retried(run: ThreadRunRef, retry: RetriedRequest, evidence: string): ReportPlan;
  outside(threadId: string, entries: RecordedEntries, evidence: string, reading?: ContextReport): ReportPlan;
  handed(run: ThreadRunRef, items: readonly string[]): ReportPlan;
  fate(run: ThreadRunRef, fate: ThreadWordFate, items: readonly string[], recorded?: true): ReportPlan;
  lapsed(run: ThreadRunRef, items: readonly string[]): ReportPlan;
  //! A refusal waiting on a person must stop follow-up wake from retrying it.
  refused(run: ThreadRunRef, lasting?: true): ReportPlan;
  ended(run: ThreadRunRef, ending: RunEnding, spend?: RunSpend): ReportPlan;
  observed(threadId: string, turn: ObservedTurn, evidence: string): ReportPlan;
  live(run: ThreadRunRef, delta: LiveDelta): Effect.Effect<void>;
  stepped(run: ThreadRunRef): Effect.Effect<void>;
  tailDue(run: ThreadRunRef): boolean;
  readonly tailEveryMs: number;
  seed(run: ThreadRunRef, tail: ThreadTranscript): void;
  cut<A, E>(threadId: string, work: Effect.Effect<A, E>): Effect.Effect<A, E | ThreadPortFailure>;
  asked(run: ThreadRunRef, question: ThreadQuestionEntry, evidence: string): ReportPlan;
  resolved(run: ThreadRunRef, questionId: string, evidence: string, closing?: 'cleared' | 'answered', note?: string): ReportPlan;
};
export class RunReports extends Context.Service<
  RunReports,
  {
    of(adapter: string, options?: AdapterOptions): AdapterReports;
  }
>()('@runlith/agent/RunReports') {}
const ENDING_TABLES: readonly ReportTable[] = ['runs', 'events', 'thread', 'inbox', 'records', 'endings', 'outbox'];
const QUESTION_TABLES: readonly ReportTable[] = ['events', 'thread', 'runs', 'records'];
export const LAPSED_CLOSER = 'unread';
export const unreadReportEnvelope = (requestId: string): string => `envelope:report:${requestId}:${LAPSED_CLOSER}`;
const UNREAD_REPORT =
  'Your words reached that agent but it never confirmed reading them within the read window, so they were closed unread and are not repeated. If the work still matters, send it again.';
const SPENT = 'spent';
const END_UNOBSERVED = 'The end of the turn was not observed, so this call has no result.';
const result = (status: ReportResult['status'], runId: string): ReportResult => ({ status, runId });
export const runReportsLayer = Layer.effect(
  RunReports,
  Effect.gen(function* () {
    const lifecycle = yield* RunLifecycle;
    const boundaries = yield* RunBoundaries;
    const gate = yield* LaunchGate;
    const control = yield* RunControl;
    const inflight = yield* WordsInFlight;
    const wakes = yield* SenderWakes;
    const store = yield* ThreadStore;
    const inbox = yield* ThreadInbox;
    const attachments = yield* ThreadAttachments;
    const feed = yield* ThreadFeed;
    const changes = yield* ThreadChanges;
    const requests = yield* RunRequests;
    const progress = yield* RunProgress;
    const clock = yield* Clock.Clock;
    const rhythm = yield* ThreadStreamRhythm;
    const tails = new RunTails(feed, () => clock.currentTimeMillisUnsafe(), rhythm.flushIntervalMs);
    const landing = new WeakMap<ThreadWriteTx, Set<string>>();
    const noted = (tx: ThreadWriteTx, written: ReadonlySet<string>): void => {
      const standing = landing.get(tx);
      if (standing === undefined) landing.set(tx, new Set(written));
      else for (const id of written) standing.add(id);
    };
    const openTail = Effect.fnUntraced(function* (run: ThreadRunRef, ending: boolean, tx: ThreadWriteTx) {
      const open: ThreadTranscriptEntry[] = [];
      const written = landing.get(tx);
      for (const entry of tails.snapshot(run, ending)) {
        if (written?.has(entry.id) === true) continue;
        if (entry.type !== 'tool' || (yield* store.entryById(run.threadId, entry.id, tx)) === undefined) open.push(entry);
      }
      return open.length === 0 ? null : open;
    });
    const snapshotted = Effect.fnUntraced(function* (run: ThreadRunRef, tx: ThreadWriteTx, durable: boolean) {
      const tail = yield* openTail(run, false, tx);
      const at = new Date(yield* Clock.currentTimeMillis);
      yield* runs.writeStreamTail(run.id, tail, at, tx, durable);
      changes.note(run.threadId, tx, {
        kind: 'run',
        run: {
          id: run.id,
          streamTail: tail === null ? null : JSON.parse(JSON.stringify(tail)),
          heartbeatAt: at,
          updatedAt: at,
          ...(durable || tail?.length ? { resumes: 0 } : {}),
        },
      });
    });
    const kernel = yield* transitionDeps;
    const ownerId = (yield* ThreadOwner).id;
    const runs = (yield* ThreadRunStoreFactory).create(ownerId);
    const signalled = readSignals(kernel, store, inbox, attachments, ownerId);
    const bound = Effect.fnUntraced(function* (
      adapter: string,
      threadId: string,
      tx: ThreadWriteTx,
    ): Effect.fn.Return<ThreadMetadataRow, ThreadPortFailure | ForeignBinding> {
      const thread = yield* store.metadata(threadId, tx);
      if (thread === undefined) return yield* Effect.fail(new ThreadNotFoundError(threadId));
      if (thread.transport.adapter !== adapter) return yield* new ForeignBinding({ threadId, adapter });
      return thread;
    });
    const questionsOf = (run: ThreadRunRef, tx: ThreadWriteTx): Effect.Effect<readonly ThreadQuestionEntry[], ThreadPortFailure> =>
      Effect.map(store.entriesOfRun(run.threadId, run.id, tx), (entries) =>
        entries.filter((entry): entry is ThreadQuestionEntry & typeof entry => entry.type === 'question'),
      );
    const land = Effect.fnUntraced(function* (
      threadId: string,
      owner: string,
      entries: RecordedEntries,
      evidence: string,
      reading: ContextReport | undefined,
      tx: ThreadWriteTx,
      digest?: string,
      key: CallKey = reportKey(owner, evidence),
    ): Effect.fn.Return<
      {
        readonly replayed: boolean;
        readonly written: ReadonlySet<string>;
        readonly answered: boolean;
        readonly generated: boolean;
      },
      ThreadPortFailure
    > {
      const prepared = yield* prepareTransition(
        kernel,
        threadId,
        typeof entries === 'function' ? (row) => sealThreadEvents(entries(row.history)) : sealThreadEvents(entries),
        tx,
      );
      const plan: TransitionPlan<'applied', ThreadWriteTx, ThreadPortFailure> = {
        declared: prepared.declared,
        decide: (view) => {
          const measured = reading === undefined ? null : readingAfter(reading, view.state.contextReading);
          return Effect.succeed({
            apply: true,
            result: 'applied' as const,
            patch: measured === null ? undefined : { contextReading: measured },
          });
        },
      };
      const outcome = yield* transitionIn(kernel, tx, prepared, plan, {
        evidence: { call: key },
        digest: digest ?? actDigest(['step', prepared.declared.map((event) => event.body), reading ?? null]),
      });
      yield* answerOf(threadId, outcome);
      const written: ReadonlySet<string> = new Set(
        prepared.declared.flatMap((event) => (event.body.payload.entry === undefined ? [] : [event.body.payload.entry.id])),
      );
      noted(tx, written);
      return {
        replayed: 'replayed' in outcome,
        written,
        answered: prepared.declared.some(({ body }) => {
          const entry = body.payload.entry;
          return entry !== undefined && coreEntry(entry) && entry.type === 'tool' && toolSettled(entry.toolState);
        }),
        generated: prepared.declared.some(({ body }) => body.payload.entry !== undefined && generatedEntry(body.payload.entry)),
      };
    });
    const charged = Effect.fnUntraced(function* (
      run: ThreadRunRef,
      evidence: string,
      digest: string,
      write: (tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>,
      tx: ThreadWriteTx,
    ): Effect.fn.Return<ReportResult, ThreadPortFailure> {
      const key = { call: chargeKey(run.id, evidence) };
      const standing = yield* kernel.transitions.readRecord(run.threadId, key, tx);
      if (standing.kind !== 'absent' && standing.kind !== 'decided') return result('replayed', run.id);
      yield* write(tx);
      yield* kernel.transitions.writeRecord(run.threadId, key, { digest, result: 'applied' }, tx);
      return result('applied', run.id);
    });
    const closeQuestion = Effect.fnUntraced(function* (
      adapter: string,
      run: ThreadRunRef,
      questionId: string,
      evidence: string,
      closing: 'cleared' | 'answered',
      note: string | undefined,
      tx: ThreadWriteTx,
    ) {
      yield* bound(adapter, run.threadId, tx);
      const standing = yield* runs.runById(run.id, tx);
      if (standing === null || standing.status !== 'running') return result('settled', run.id);
      if (standing.ownerId !== ownerId) return result('unowned', run.id);
      const known = yield* questionsOf(run, tx);
      const entry = known.findLast((each) => each.questionId === questionId);
      if (entry === undefined || entry.status !== 'open') return result('replayed', run.id);
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      const { deliveryNote: _delivery, ...standingEntry } = entry;
      const decision = note === undefined ? {} : { decision: { note } };
      const closed: ThreadQuestionEntry =
        closing === 'answered'
          ? { ...standingEntry, ...decision, status: 'answered', updatedAt: at }
          : { ...withoutAnswers(standingEntry), ...decision, status: 'cleared', updatedAt: at };
      const prepared = yield* prepareTransition(kernel, run.threadId, sealThreadEvents([threadQuestionEvent(closed)]), tx);
      const plan: TransitionPlan<'applied', ThreadWriteTx, ThreadPortFailure> = {
        declared: prepared.declared,
        decide: (view) =>
          Effect.map(
            routedChange(store, runs, run.threadId, view.row.pendingInteraction, closed, tx, true),
            (change): Decision<'applied', ThreadWriteTx, ThreadPortFailure> =>
              change === null
                ? { replayed: 'applied' }
                : {
                    apply: true as const,
                    result: 'applied' as const,
                    patch: change.slot === view.row.pendingInteraction ? undefined : { pendingInteraction: change.slot },
                    participants: change.participants ?? undefined,
                  },
          ),
      };
      const outcome = yield* transitionIn(kernel, tx, prepared, plan, {
        evidence: { call: reportKey(run.id, evidence) },
        digest: actDigest(['resolved', questionId]),
      });
      yield* answerOf(run.threadId, outcome);
      return 'replayed' in outcome ? result('replayed', run.id) : result('applied', run.id);
    });
    const reports = (adapter: string, options: AdapterOptions = {}): AdapterReports => ({
      measured: (run, request, evidence) => ({
        tables: ['events', 'thread', 'records', 'runs'],
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, run.threadId, tx);
          const standing = yield* runs.runById(run.id, tx);
          if (standing !== null && standing.status === 'running' && standing.ownerId !== ownerId) return result('unowned', run.id);
          if (standing === null) return result('settled', run.id);
          const stepNumber = yield* readThreadRunStepsTaken(kernel.log, kernel.kinds, run, {}, tx);
          const landing = yield* requests.land(standing, { stepNumber, attempt: request.attempt, usage: request.usage }, tx);
          const digest = actDigest(['measured', request.usage, request.attempt]);
          if (standing.status !== 'running') return yield* charged(run, evidence, digest, landing.write, tx);
          const reading = request.reading === undefined ? undefined : { ...request.reading, runId: run.id, stepNumber };
          const context: ThreadStepContext = {
            runId: run.id,
            stepNumber,
            provider: reading?.provider ?? standing.provider,
            model: reading?.model ?? standing.model,
            contextWindow: reading?.contextWindow ?? null,
            measuredAt: reading?.measuredAt ?? new Date(yield* Clock.currentTimeMillis).toISOString(),
          };
          const landed = yield* land(
            run.threadId,
            run.id,
            [threadStepFinishedEvent(context, request.usage), ...landing.events],
            evidence,
            reading === undefined ? undefined : { kind: 'measured', reading },
            tx,
            digest,
            chargeKey(run.id, evidence),
          );
          if (landed.replayed) return result('replayed', run.id);
          yield* landing.write(tx);
          yield* progress.written(run, tx);
          yield* snapshotted(run, tx, true);
          return result('applied', run.id);
        }),
      }),
      retried: (run, retry, evidence) => ({
        tables: ['events', 'thread', 'records', 'runs'],
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, run.threadId, tx);
          const standing = yield* runs.runById(run.id, tx);
          if (standing !== null && standing.status === 'running' && standing.ownerId !== ownerId) return result('unowned', run.id);
          if (standing === null || standing.status !== 'running') return result('settled', run.id);
          const stepNumber = yield* readThreadRunStepsTaken(kernel.log, kernel.kinds, run, {}, tx);
          const occurredAt = new Date(yield* Clock.currentTimeMillis).toISOString();
          const entry: ThreadRetryEntry = {
            type: 'retry',
            id: retryEntryId(run.id, stepNumber, retry.attempt),
            runId: run.id,
            stepNumber,
            attempt: retry.attempt,
            of: retry.of,
            family: retry.family,
            delayMs: retry.delayMs,
            message: retry.message,
            reason: { family: retry.family, status: retry.status, attempt: retry.attempt },
            occurredAt,
          };
          const interrupted = tails.retired(run, { stepNumber, attempt: retry.attempt, cause: entry.reason }, occurredAt);
          const landed = yield* land(
            run.threadId,
            run.id,
            [threadEntryEvent(entry), ...interrupted.map(threadEntryEvent)],
            evidence,
            undefined,
            tx,
            actDigest(['retried', retry]),
          );
          if (landed.replayed) return result('replayed', run.id);
          yield* progress.written(run, tx);
          yield* snapshotted(run, tx, false);
          yield* tx.afterCommit(Effect.sync(() => tails.landed(run, landed.written)));
          return result('applied', run.id);
        }),
      }),
      recorded: (run, entries, evidence, options) => ({
        tables: ['events', 'thread', 'records', 'runs'],
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, run.threadId, tx);
          const standing = yield* runs.runById(run.id, tx);
          if (standing !== null && standing.status === 'running' && standing.ownerId !== ownerId) return result('unowned', run.id);
          if (standing === null || standing.status !== 'running') return result('settled', run.id);
          const landed = yield* land(run.threadId, run.id, entries, evidence, options?.reading, tx);
          yield* tx.afterCommit(Effect.sync(() => tails.landed(run, landed.written)));
          if (landed.replayed) return result('replayed', run.id);
          yield* progress.written(run, tx);
          yield* snapshotted(run, tx, landed.generated);
          if (options?.unconfirming !== true) yield* tx.afterCommit(Effect.sync(() => gate.confirmed(run.threadId)));
          if (landed.answered) yield* tx.afterCommit(changes.publish(run.threadId));
          return result('applied', run.id);
        }),
      }),
      outside: (threadId, entries, evidence, reading) => ({
        tables: ['events', 'thread', 'records'],
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, threadId, tx);
          const landed = yield* land(threadId, threadId, entries, evidence, reading, tx);
          return result(landed.replayed ? 'replayed' : 'applied', threadId);
        }),
      }),
      handed: (run, items) => ({
        tables: [],
        run: (tx) =>
          Effect.as(
            tx.afterCommit(
              Effect.andThen(
                Effect.sync(() => inflight.handed(run, items)),
                changes.publish(run.threadId),
              ),
            ),
            result('applied', run.id),
          ),
      }),
      fate: (run, fate, items, recorded) => ({
        tables: fate === 'read' || fate === 'unconfirmed' ? ['inbox', 'events', 'thread', 'records'] : ['inbox'],
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, run.threadId, tx);
          if (recorded !== true && (fate === 'read' || fate === 'unconfirmed')) yield* signalled(run, items, fate, tx);
          yield* inbox.fated(run.threadId, run.id, items, fate, tx);
          yield* tx.afterCommit(Effect.sync(() => inflight.settled(run, items)));
          return result('applied', run.id);
        }),
      }),
      lapsed: (run, items) => ({
        tables: ENDING_TABLES,
        run: Effect.fnUntraced(function* (tx) {
          const thread = yield* bound(adapter, run.threadId, tx);
          const open: ThreadInboxItem[] = [];
          for (const id of items) {
            const item = yield* inbox.receipt(id, tx);
            if (item !== undefined && item.threadId === run.threadId && item.state !== 'acknowledged') open.push(item);
          }
          if (open.length === 0) return result('settled', run.id);
          const ids = open.map((item) => item.id);
          const intended: string[] = [];
          yield* inbox.fated(run.threadId, run.id, ids, 'acknowledged', tx);
          for (const item of open) {
            if (!isInboxRequest(item)) continue;
            const asked = item.sender.kind === 'thread' ? yield* store.metadata(item.sender.threadId, tx) : undefined;
            if (item.sender.kind !== 'thread' || asked === undefined) {
              yield* inbox.closeRequests([item.id], THREAD_REQUEST_REQUESTER_GONE, tx);
              continue;
            }
            const report = unreadReportEnvelope(item.id);
            const written = yield* inbox.put(
              {
                id: report,
                threadId: asked.id,
                sender: {
                  kind: 'thread',
                  threadId: thread.id,
                  name: thread.name ?? thread.id,
                  ...(thread.projectId == null ? {} : { projectId: thread.projectId }),
                },
                kind: 'envelope',
                body: { intent: 'report', text: UNREAD_REPORT, inReplyTo: item.id },
                occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
              },
              tx,
            );
            yield* inbox.closeRequests([item.id], report, tx);
            if (written.fresh) intended.push(written.item.id);
          }
          const standing = yield* runs.runById(run.id, tx);
          if (
            standing !== null &&
            standing.status === 'running' &&
            standing.ownerId === ownerId &&
            wordsOnly(standing, yield* store.entriesOfRun(run.threadId, run.id, tx))
          )
            yield* lifecycle.stop(run, { by: null, marker: false, withdraw: true }, false, tx);
          yield* inbox.intendWake(intended, tx);
          yield* tx.afterCommit(
            Effect.andThen(
              Effect.sync(() => inflight.settled(run, ids)),
              intended.length === 0 ? Effect.void : wakes.kick(),
            ),
          );
          return result('applied', run.id);
        }),
      }),
      refused: (run, lasting) => ({
        tables: ['thread'],
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, run.threadId, tx);
          const standing = yield* runs.runById(run.id, tx);
          if (standing === null || standing.status !== 'running') return result('settled', run.id);
          if (standing.ownerId !== ownerId) return result('unowned', run.id);
          yield* tx.afterCommit(Effect.sync(() => gate.refused(run.threadId, lasting)));
          return result('applied', run.id);
        }),
      }),
      live: (run, delta) =>
        delta.op === 'phase'
          ? progress.enter(run, delta.phase, { waiting: delta.waiting })
          : Effect.sync(() => tails.apply(run, delta, options.display)),
      stepped: boundaries.reached,
      tailDue: (run) => tails.due(run),
      tailEveryMs: rhythm.flushIntervalMs,
      seed: (run, tail) => tails.seed(run, tail),
      cut: (threadId, work) => kernel.lane.order(threadId, feed.atCut(threadId, work)),
      ended: (run, ending, spend = {}) => ({
        tables: ENDING_TABLES,
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, run.threadId, tx);
          const standing = yield* runs.runById(run.id, tx);
          const unsuccessful = ending.kind === 'completed' && ending.finish !== undefined ? unsuccessfulFinish(ending.finish) : null;
          if (
            ending.kind === 'completed' &&
            unsuccessful === null &&
            standing !== null &&
            standing.status === 'running' &&
            standing.ownerId === ownerId
          ) {
            const open = (yield* questionsOf(run, tx)).filter((entry) => entry.status === 'open' && routedEntry(entry));
            for (const entry of open) {
              yield* closeQuestion(
                adapter,
                run,
                entry.questionId,
                `ended:${entry.questionId}`,
                'cleared',
                endedWhileOpen('completed', null),
                tx,
              );
            }
          }
          if (standing !== null && (spend.rest !== undefined || spend.cost !== undefined)) {
            const charge = { usage: spend.rest ?? null, cost: spend.cost ?? null };
            yield* charged(run, SPENT, actDigest([SPENT]), (unit) => runs.charge(run.id, charge, unit), tx);
          }
          if (standing !== null && standing.status === 'running')
            yield* runs.writeStreamTail(run.id, yield* openTail(run, true, tx), new Date(yield* Clock.currentTimeMillis), tx);
          yield* tx.afterCommit(Effect.sync(() => tails.apply(run, { op: 'close' }, undefined)));
          if (ending.kind === 'aborted') {
            const observed = standing !== null && standing.stopRequest === null;
            const by = observed ? (ending.stoppedBy ?? 'reader') : ending.stoppedBy;
            const stopped = yield* lifecycle.stop(run, { by, marker: observed, withdraw: false }, false, tx);
            return result(stopped === 'stopped' ? 'applied' : 'settled', run.id);
          }
          const launch = ending.kind === 'failed' && ending.launch === true;
          if (launch) yield* tx.afterCommit(Effect.sync(() => inflight.returned(run)));
          const end = yield* lifecycle.finish(
            run,
            ending.kind === 'failed'
              ? {
                  kind: 'broke',
                  cause: Cause.fail(new TransportFailed({ message: ending.reason, failure: ending.cause })),
                  departing: false,
                  returnsWords: launch ? (true as const) : undefined,
                }
              : unsuccessful !== null
                ? { kind: 'broke', cause: Cause.fail(unsuccessful), departing: false }
                : { kind: 'completed', unsettled: ending.unobserved === true ? END_UNOBSERVED : undefined },
            tx,
          );
          switch (end) {
            case 'committed':
              return result('applied', run.id);
            case 'replayed':
              return result('replayed', run.id);
            case 'not-running':
              return result('settled', run.id);
            case 'left':
              return result('left', run.id);
          }
        }),
      }),
      observed: (threadId, turn, evidence) => ({
        tables: ENDING_TABLES,
        run: Effect.fnUntraced(function* (tx) {
          const thread = yield* bound(adapter, threadId, tx);
          if (thread.capabilities.openings !== 'core-and-observed') return yield* new OpeningsRefused({ threadId, adapter });
          const keyed = yield* runs.runByStartKey(threadId, evidence, tx);
          if (keyed !== null) return result('replayed', keyed.id);
          if (turn.displaces !== null) {
            const displaced = yield* runs.runById(turn.displaces, tx);
            if (displaced !== null && displaced.status === 'running' && displaced.ownerId !== ownerId) {
              return result('unowned', turn.displaces);
            }
          }
          const startFrom: ThreadRunStartFrom = {
            id: thread.id,
            ownerId: thread.ownerId,
            account: thread.account,
            provider: thread.provider,
            model: thread.model,
            reasoning: thread.reasoning,
            switches: thread.switches,
          };
          const runId = mintThreadRunId();
          yield* lifecycle.observe({
            startFrom,
            approval: turn.approval,
            runId,
            displaces: turn.displaces,
            startKey: { key: evidence, digest: actDigest(['observed', turn.displaces]) },
            entries: turn.entries(runId),
            tx,
          });
          yield* tx.afterCommit(Effect.sync(() => control.drive({ id: runId, threadId })));
          return result('applied', runId);
        }),
      }),
      asked: (run, question, evidence) => ({
        tables: QUESTION_TABLES,
        run: Effect.fnUntraced(function* (tx) {
          yield* bound(adapter, run.threadId, tx);
          const standing = yield* runs.runById(run.id, tx);
          if (standing === null || standing.status !== 'running') return result('settled', run.id);
          if (standing.ownerId !== ownerId) return result('unowned', run.id);
          const known = yield* questionsOf(run, tx);
          if (known.some((each) => each.questionId === question.questionId)) return result('replayed', run.id);
          const at = new Date(yield* Clock.currentTimeMillis).toISOString();
          const entry: ThreadQuestionEntry = {
            ...withoutAnswers(question),
            runId: run.id,
            status: 'open',
            route: adapter,
            occurredAt: question.occurredAt ?? at,
            updatedAt: at,
          };
          const prepared = yield* prepareTransition(kernel, run.threadId, sealThreadEvents([threadQuestionEvent(entry)]), tx);
          const plan: TransitionPlan<'applied', ThreadWriteTx, ThreadPortFailure> = {
            declared: prepared.declared,
            decide: (view) =>
              Effect.map(routedChange(store, runs, run.threadId, view.row.pendingInteraction, entry, tx, false), (change) => ({
                apply: true as const,
                result: 'applied' as const,
                patch: change === null || change.slot === view.row.pendingInteraction ? undefined : { pendingInteraction: change.slot },
                participants: change === null || change.participants === null ? undefined : change.participants,
              })),
          };
          const outcome = yield* transitionIn(kernel, tx, prepared, plan, {
            evidence: { call: reportKey(run.id, evidence) },
            digest: actDigest(['asked', entry.questionId]),
          });
          yield* answerOf(run.threadId, outcome);
          if ('replayed' in outcome) return result('replayed', run.id);
          yield* tx.afterCommit(Effect.sync(() => tails.apply(run, { op: 'close' }, undefined)));
          return result('applied', run.id);
        }),
      }),
      resolved: (run, questionId, evidence, closing = 'cleared', note) => ({
        tables: QUESTION_TABLES,
        run: (tx) => closeQuestion(adapter, run, questionId, evidence, closing, note, tx),
      }),
    });
    return RunReports.of({ of: reports });
  }),
);
