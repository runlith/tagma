import { Clock, Context, Deferred, Duration, Effect, FiberSet, Layer, Option, Semaphore } from 'effect';
import {
  THREAD_TOOL_CANCEL_VALUE,
  THREAD_TOOL_CONFIRM_KIND,
  THREAD_TOOL_CONFIRM_VALUE,
  USER_QUESTION_TOOL_NAME,
} from '../../transcript/parts';
import type { ToolConfirmationFact } from '../../agent/contracts';
import type { AgentToolStop } from '../../agent/door/types';
import { interactionQuestionEntryId } from '../../transcript/entryNames';
import { toolConfirmationData } from '../../transcript/live';
import type { ThreadInteractionAnswer, ThreadQuestionCleared, ThreadQuestionEntry } from '../../transcript/entries';
import { threadQuestionEvent } from '../events';
import type { ThreadMetadataRow } from '../rows';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '../storage/runs';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { Transports } from '../transport/Transports';
import { sealThreadEvents } from '../ThreadEventDoor';
import { ThreadOwner, ThreadRunStoreFactory, ThreadStore, type ThreadWriteTx } from '../ThreadPorts';
import { answerOf, transitionDeps, transitionNow } from '../transition/kernel';
import { ThreadActReusedError, ThreadActSpentError, type Decision } from '../transition/port';
import { approvalScope, isApprovalScope, slotAfter } from './pendingSlot';
import { QuestionDeadlines } from './QuestionDeadlines';
import { Approvers } from '../Approvers';
import type { CallerKey } from '../keyed';
import { makeParkedQuestions, answerKey } from './ParkedQuestions';
import { openQuestionsOf } from './openQuestions';
import { announcedTo, routedTo } from './questionRouting';
import { QuestionIntake } from './scheduler/intake';
import { ThreadRunLedger, settledOutcome } from './ThreadRunLedger';
import { ThreadRunSettlements } from './ThreadRunSettlements';
import { endedWhileOpen, routedEntry } from './routedQuestions';
import { routedChange } from './RoutedTransition';
import { makeRoutedAnswers } from './RoutedAnswers';
import { ThreadSnapshots } from './ThreadSnapshots';
import { bypassAnswers, confirmedByReader, declinedBy, isToolConfirmationQuestion } from './ToolQuestion';
export type QuestionRefusal = {
  readonly refused: string;
};
export type QuestionOutcome =
  | {
      readonly kind: 'answered';
      readonly entry: ThreadQuestionEntry;
      readonly answers: readonly ThreadInteractionAnswer[];
    }
  | ThreadQuestionCleared
  | {
      readonly kind: 'lapsed';
      readonly entry: ThreadQuestionEntry;
      readonly withinMs: number;
    };
export type Asking = {
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly compose: () => Effect.Effect<ThreadQuestionEntry | QuestionRefusal, ThreadBorderFailed>;
  readonly withinMs?: number;
  readonly unasked?: () => boolean;
  readonly stopped?: Effect.Effect<AgentToolStop>;
};
export type ApprovalRequest = {
  readonly threadId: string;
  readonly key: string;
  readonly operation: string;
  readonly summary: string;
  readonly facts?: readonly ToolConfirmationFact[];
  readonly consequence?: string;
  readonly asked: readonly string[];
  readonly withinMs: number | null;
  readonly waitMs: number;
};
export type ApprovalState =
  | {
      readonly kind: 'given';
    }
  | {
      readonly kind: 'declined';
      readonly by?: string;
      readonly note?: string;
    }
  | {
      readonly kind: 'waiting';
      readonly questionId: string;
    }
  | {
      readonly kind: 'lapsed';
      readonly questionId: string;
      readonly withinMs: number;
    };
export class Questions extends Context.Service<
  Questions,
  {
    ask(asking: Asking): Effect.Effect<QuestionOutcome | QuestionRefusal | null, ThreadBorderFailed>;
    answer(
      threadId: string,
      questionId: string,
      answers: readonly ThreadInteractionAnswer[],
      call?: CallerKey,
    ): Effect.Effect<
      {
        readonly runId: string;
      } | null,
      ThreadBorderFailed
    >;
    approve(request: ApprovalRequest): Effect.Effect<ApprovalState, ThreadBorderFailed>;
    open(threadId: string): Effect.Effect<readonly ThreadQuestionEntry[], ThreadBorderFailed>;
    decide(request: {
      readonly threadId: string;
      readonly questionId: string;
      readonly caller: string;
      readonly note?: string;
    }): Effect.Effect<'decided' | 'not-the-approver' | 'unknown', ThreadBorderFailed>;
    decline(request: {
      readonly threadId: string;
      readonly questionId: string;
      readonly caller: string;
    }): Effect.Effect<'declined' | 'not-the-approver' | 'unknown', ThreadBorderFailed>;
    reroute(threadId: string): Effect.Effect<void, ThreadBorderFailed>;
    holds(threadId: string, questionId: string): Effect.Effect<boolean, ThreadBorderFailed>;
    close(threadId: string, runId: string, reason: string): Effect.Effect<void, ThreadBorderFailed>;
    withdraw(threadId: string, toolCallId: string, reason: string): Effect.Effect<void, ThreadBorderFailed>;
  }
>()('@runlith/agent/Questions') {}
type Waiter = {
  readonly runId: string;
  readonly entry: ThreadQuestionEntry;
  readonly outcome: Deferred.Deferred<QuestionOutcome, ThreadBorderFailed>;
};
type Posed =
  | {
      readonly kind: 'unasked';
    }
  | {
      readonly kind: 'refused';
      readonly refused: string;
    }
  | {
      readonly kind: 'settled';
      readonly outcome: QuestionOutcome;
    }
  | {
      readonly kind: 'waiting';
      readonly waiter: Waiter;
    };
type Lock = {
  readonly lock: Semaphore.Semaphore;
  users: number;
};
const waiterKey = (threadId: string, questionId: string): string => `${threadId}\u0000${questionId}`;
const hostedKind = (entry: ThreadQuestionEntry): boolean =>
  isToolConfirmationQuestion(entry) || entry.toolCalls.some((call) => call.toolName === USER_QUESTION_TOOL_NAME);
const outcomeOf = (entry: ThreadQuestionEntry, withinMs: number | undefined): QuestionOutcome => {
  withinMs = entry.timeoutMs === null ? undefined : (entry.timeoutMs ?? withinMs);
  if (entry.status === 'answered') {
    const askedAt = entry.occurredAt === undefined ? Number.NaN : Date.parse(entry.occurredAt);
    const answeredAt = entry.updatedAt === undefined ? Number.NaN : Date.parse(entry.updatedAt);
    if (withinMs !== undefined && Number.isFinite(askedAt) && Number.isFinite(answeredAt) && answeredAt - askedAt > withinMs)
      return { kind: 'lapsed', entry, withinMs };
    return { kind: 'answered', entry, answers: entry.answers ?? [] };
  }
  if (entry.status === 'lapsed') return { kind: 'lapsed', entry, withinMs: entry.timeoutMs ?? withinMs ?? 0 };
  return entry.outcome ?? { kind: 'cleared' };
};
export const questionsLayer = Layer.effectContext(
  Effect.gen(function* () {
    const deadlines = yield* QuestionDeadlines;
    const approvers = yield* Approvers;
    const ledger = yield* ThreadRunLedger;
    const snapshots = yield* ThreadSnapshots;
    const store = yield* ThreadStore;
    const transports = yield* Transports;
    const runs = (yield* ThreadRunStoreFactory).create((yield* ThreadOwner).id);
    const kernel = yield* transitionDeps;
    const waiters = new Map<string, Waiter>();
    const locks = new Map<string, Lock>();
    const maintenance = yield* FiberSet.make<void, never>();
    const runMaintenance = yield* FiberSet.runtime(maintenance)();
    const parked = yield* makeParkedQuestions(runMaintenance, (asking) => questions.ask(asking));
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'open question',
      handle: (event) =>
        settledOutcome(event) === 'completed'
          ? Effect.void
          : parked.clear(
              event.threadId,
              event.runId,
              event.status === 'aborted' || event.status === 'withdrawn'
                ? 'Thread run stopped.'
                : event.status === 'cut'
                  ? 'Thread run was interrupted; continue the thread to ask again.'
                  : 'Thread run failed.',
            ),
    });
    const locked = <A, E>(threadId: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          const standing = locks.get(threadId) ?? { lock: Semaphore.makeUnsafe(1), users: 0 };
          locks.set(threadId, standing);
          standing.users += 1;
          return restore(standing.lock.withPermit(work)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                standing.users -= 1;
                if (standing.users === 0 && locks.get(threadId) === standing) locks.delete(threadId);
              }),
            ),
          );
        }),
      );
    const commit = (
      threadId: string,
      runId: string,
      entry: ThreadQuestionEntry,
      decidedBy: string,
      requiresOpen = false,
    ): Effect.Effect<boolean, ThreadBorderFailed> =>
      Effect.flatMap(
        transitionNow<undefined, ThreadWriteTx>(
          kernel,
          threadId,
          {
            declared: sealThreadEvents([threadQuestionEvent(entry)]),
            decide: Effect.fnUntraced(function* ({ row }, tx) {
              if (!routedEntry(entry)) {
                const next = yield* slotAfter(
                  kernel.store,
                  threadId,
                  row.pendingInteraction,
                  entry,
                  isApprovalScope(runId) ? 'standalone' : 'hosted',
                  tx,
                );
                return {
                  apply: true,
                  result: undefined,
                  patch: next === row.pendingInteraction ? undefined : { pendingInteraction: next },
                } as Decision<undefined, ThreadWriteTx>;
              }
              const change = yield* routedChange(kernel.store, runs, threadId, row.pendingInteraction, entry, tx, requiresOpen);
              if (change === null) return { refuse: undefined } as Decision<undefined, ThreadWriteTx>;
              return {
                apply: true,
                result: undefined,
                patch: change.slot === row.pendingInteraction ? undefined : { pendingInteraction: change.slot },
                participants: change.participants ?? undefined,
              } as Decision<undefined, ThreadWriteTx>;
            }),
          },
          { evidence: { decidedBy: `hosted:${runId}:${decidedBy}` }, digest: decidedBy },
        ),
        (outcome) => Effect.as(answerOf(threadId, outcome), !('refused' in outcome)),
      ).pipe(Effect.tap(() => snapshots.publish(threadId)));
    const keyedAnswer = (
      threadId: string,
      questionId: string,
      answers: readonly ThreadInteractionAnswer[],
      call: CallerKey | undefined,
      work: Effect.Effect<
        {
          readonly runId: string;
        } | null,
        ThreadBorderFailed
      >,
    ): Effect.Effect<
      {
        readonly runId: string;
      } | null,
      ThreadBorderFailed
    > =>
      call === undefined
        ? work
        : Effect.gen(function* () {
            const key = answerKey(threadId, questionId, answers, call);
            const reading = yield* kernel.transitions.readRecord(threadId, key.evidence);
            if (reading.kind === 'present' || reading.kind === 'spent') {
              if (reading.digest !== key.digest) return yield* Effect.fail(new ThreadActReusedError({ threadId, evidence: key.evidence }));
              if (reading.kind === 'spent') return yield* Effect.fail(new ThreadActSpentError({ threadId, at: reading.at }));
              return { runId: String(reading.result) };
            }
            if (reading.kind === 'before-epoch') return yield* Effect.fail(new ThreadActSpentError({ threadId, at: 'before-epoch' }));
            const result = yield* work;
            if (result === null) return null;
            yield* transitionNow<string, ThreadWriteTx>(
              kernel,
              threadId,
              { declared: [], decide: () => Effect.succeed({ apply: true, result: result.runId } as Decision<string, ThreadWriteTx>) },
              key,
            );
            return result;
          });
    const recorded = (threadId: string, runId: string): Effect.Effect<readonly ThreadQuestionEntry[], ThreadBorderFailed> =>
      Effect.map(store.entriesOfRun(threadId, runId), (entries) =>
        entries.filter((entry): entry is ThreadQuestionEntry & typeof entry => entry.type === 'question'),
      );
    const routed = (threadId: string, entry: ThreadQuestionEntry): Effect.Effect<ThreadQuestionEntry, ThreadBorderFailed> =>
      routedTo(approvers, threadId, entry);
    const announced = (threadId: string, entry: ThreadQuestionEntry): Effect.Effect<void, ThreadBorderFailed> =>
      announcedTo(approvers, threadId, entry);
    const standing = (threadId: string, runId: string, match: (entry: ThreadQuestionEntry) => boolean) =>
      Effect.map(recorded(threadId, runId), (entries) => entries.filter((entry) => hostedKind(entry) && match(entry)).at(-1) ?? null);
    const hostedThread = Effect.fnUntraced(function* (threadId: string): Effect.fn.Return<ThreadMetadataRow | null, ThreadBorderFailed> {
      const thread = yield* store.metadata(threadId);
      return thread?.transport.agent == null ? null : thread;
    });
    const staged = (threadId: string, runId: string): Effect.Effect<void, ThreadBorderFailed> =>
      isApprovalScope(runId)
        ? Effect.void
        : Effect.gen(function* () {
            const thread = yield* hostedThread(threadId);
            const run = thread === null ? null : yield* ledger.activeRun(threadId);
            if (thread === null || run?.id !== runId) return;
            const waiting = (yield* recorded(threadId, runId)).some((entry) => entry.status === 'open');
            if (waiting) {
              const transport = yield* transports.of(thread).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
              yield* transport.runs.reached(run, 'all');
            }
            yield* runs.writeProgress(
              runId,
              waiting
                ? { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: 'The agent waits for an answer.' }
                : { stage: 'running', message: 'The agent works.' },
              new Date(yield* Clock.currentTimeMillis),
            );
            yield* snapshots.publish(threadId);
          });
    const settle = Effect.fnUntraced(function* (
      threadId: string,
      waiter: Waiter | undefined,
      entry: ThreadQuestionEntry,
      runId: string,
      status: 'answered' | 'cleared' | 'lapsed',
      answers: readonly ThreadInteractionAnswer[] | undefined,
      outcome: QuestionOutcome,
    ): Effect.fn.Return<void, ThreadBorderFailed> {
      const settled: ThreadQuestionEntry = {
        ...entry,
        status,
        answers: answers ?? entry.answers,
        outcome: outcome.kind === 'cleared' ? outcome : undefined,
        updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      };
      yield* commit(threadId, runId, settled, `question:${entry.questionId}:${status}`);
      deadlines.disarm(runId, entry.questionId);
      if (waiter !== undefined) {
        waiters.delete(waiterKey(threadId, entry.questionId));
        yield* Deferred.succeed(waiter.outcome, outcome);
      }
      yield* staged(threadId, runId);
    });
    const located = Effect.fnUntraced(function* (
      threadId: string,
      questionId: string,
    ): Effect.fn.Return<
      {
        readonly runId: string;
        readonly entry: ThreadQuestionEntry | null;
        readonly waiter?: Waiter;
      },
      ThreadBorderFailed
    > {
      const waiter = waiters.get(waiterKey(threadId, questionId));
      if (waiter !== undefined) return { runId: waiter.runId, entry: waiter.entry, waiter };
      const run = yield* ledger.activeRun(threadId);
      const entries = run === null ? [] : yield* recorded(threadId, run.id);
      const inRun = entries.filter((each) => (hostedKind(each) || routedEntry(each)) && each.questionId === questionId).at(-1) ?? null;
      if (run !== null && inRun !== null) return { runId: run.id, entry: inRun };
      const scope = approvalScope(threadId);
      return { runId: scope, entry: yield* standing(threadId, scope, (each) => each.questionId === questionId) };
    });
    const answeredIn = Effect.fnUntraced(function* (
      threadId: string,
      questionId: string,
      answers: readonly ThreadInteractionAnswer[],
    ): Effect.fn.Return<
      {
        readonly runId: string;
      } | null,
      ThreadBorderFailed
    > {
      const { runId, entry, waiter } = yield* located(threadId, questionId);
      if (entry === null || entry.status !== 'open') return null;
      yield* settle(threadId, waiter, entry, runId, 'answered', answers, {
        kind: 'answered',
        entry: { ...entry, status: 'answered', answers },
        answers,
      });
      return { runId };
    });
    const lapse = (threadId: string, runId: string, questionId: string, withinMs: number): Effect.Effect<void, ThreadBorderFailed> =>
      locked(
        threadId,
        Effect.gen(function* () {
          const { entry, waiter } = yield* located(threadId, questionId);
          if (entry === null || entry.status !== 'open') return;
          yield* settle(threadId, waiter, entry, runId, 'lapsed', undefined, { kind: 'lapsed', entry, withinMs });
        }),
      );
    const arm = (threadId: string, waiter: Waiter, withinMs: number | undefined): void => {
      if (withinMs === undefined) return;
      deadlines.arm(
        {
          runId: waiter.runId,
          questionId: waiter.entry.questionId,
          withinMs,
          askedAt: waiter.entry.occurredAt,
        },
        lapse(threadId, waiter.runId, waiter.entry.questionId, withinMs),
      );
    };
    const posed = (asking: Asking): Effect.Effect<Posed, ThreadBorderFailed> =>
      locked(
        asking.threadId,
        Effect.gen(function* () {
          const { threadId, runId, withinMs } = asking;
          const recordedFor = yield* standing(threadId, runId, (each) =>
            each.toolCalls.some((call) => call.toolCallId === asking.toolCallId),
          );
          if (asking.unasked?.() === true) {
            if (recordedFor === null) return { kind: 'unasked' } as const;
            if (recordedFor.status === 'open') {
              const answers = bypassAnswers(recordedFor);
              yield* answeredIn(threadId, recordedFor.questionId, answers);
              return {
                kind: 'settled',
                outcome: { kind: 'answered', entry: { ...recordedFor, status: 'answered', answers }, answers },
              } as const;
            }
          }
          if (recordedFor !== null && recordedFor.status !== 'open')
            return { kind: 'settled', outcome: outcomeOf(recordedFor, withinMs) } as const;
          const held = recordedFor === null ? undefined : waiters.get(waiterKey(threadId, recordedFor.questionId));
          if (held !== undefined) {
            yield* announced(threadId, held.entry);
            return { kind: 'waiting', waiter: held } as const;
          }
          const composed = recordedFor ?? (yield* asking.compose());
          if ('refused' in composed) return { kind: 'refused', refused: composed.refused } as const;
          const entry = recordedFor === null ? yield* routed(threadId, { ...composed, timeoutMs: withinMs ?? null }) : composed;
          const waiter: Waiter = { runId, entry, outcome: Deferred.makeUnsafe<QuestionOutcome, ThreadBorderFailed>() };
          waiters.set(waiterKey(threadId, entry.questionId), waiter);
          if (recordedFor === null) {
            yield* commit(threadId, runId, entry, `question:${entry.questionId}`);
          }
          yield* announced(threadId, entry);
          yield* staged(threadId, runId);
          arm(threadId, waiter, entry.timeoutMs === null ? undefined : (entry.timeoutMs ?? withinMs));
          return { kind: 'waiting', waiter } as const;
        }),
      );
    const promptOf = (request: ApprovalRequest, questionId: string): ThreadQuestionEntry => ({
      type: 'question',
      id: interactionQuestionEntryId(questionId),
      runId: approvalScope(request.threadId),
      questionId,
      questions: [
        {
          id: questionId,
          toolCallId: questionId,
          kind: THREAD_TOOL_CONFIRM_KIND,
          prompt: request.summary,
          options: [
            { value: THREAD_TOOL_CONFIRM_VALUE, label: 'Allow' },
            { value: THREAD_TOOL_CANCEL_VALUE, label: 'Cancel' },
          ],
          data: toolConfirmationData({
            toolName: request.operation,
            asked: request.asked,
            facts: request.facts?.length ? request.facts : undefined,
            consequence: request.consequence,
          }),
        },
      ],
      toolCalls: [{ toolCallId: questionId, toolName: request.operation }],
      status: 'open',
      timeoutMs: request.withinMs,
      action: { key: request.key, operation: request.operation },
    });
    const approving = (request: ApprovalRequest): Effect.Effect<ApprovalState | Waiter, ThreadBorderFailed> =>
      locked(
        request.threadId,
        Effect.gen(function* () {
          const { threadId } = request;
          const scope = approvalScope(threadId);
          const last = (yield* recorded(threadId, scope)).filter((entry) => entry.action?.key === request.key).at(-1) ?? null;
          if (last?.status === 'answered') {
            yield* settle(threadId, undefined, last, scope, 'cleared', undefined, { kind: 'cleared' });
            if (confirmedByReader(last.answers ?? [], last.questionId)) return { kind: 'given' } as const;
            return { kind: 'declined', ...declinedBy(last) } as const;
          }
          if (last?.status === 'open') {
            const held = waiters.get(waiterKey(threadId, last.questionId));
            if (held !== undefined) {
              yield* announced(threadId, held.entry);
              return held;
            }
          }
          const now = yield* Clock.currentTimeMillis;
          const entry =
            last?.status === 'open'
              ? last
              : yield* routed(threadId, {
                  ...promptOf(request, `approval:${request.key}:${now}`),
                  occurredAt: new Date(now).toISOString(),
                });
          const waiter: Waiter = { runId: scope, entry, outcome: Deferred.makeUnsafe<QuestionOutcome, ThreadBorderFailed>() };
          waiters.set(waiterKey(threadId, entry.questionId), waiter);
          if (last?.status !== 'open') {
            yield* commit(threadId, scope, entry, `question:${entry.questionId}`);
          }
          yield* announced(threadId, entry);
          arm(threadId, waiter, entry.timeoutMs === null ? undefined : (entry.timeoutMs ?? request.withinMs ?? undefined));
          return waiter;
        }),
      );
    const approve = Effect.fnUntraced(function* (request: ApprovalRequest): Effect.fn.Return<ApprovalState, ThreadBorderFailed> {
      const posed = yield* approving(request);
      if ('kind' in posed) return posed;
      const questionId = posed.entry.questionId;
      const heard = yield* Deferred.await(posed.outcome).pipe(Effect.timeoutOption(Duration.millis(request.waitMs)));
      if (Option.isNone(heard)) return { kind: 'waiting', questionId } as const;
      if (heard.value.kind === 'lapsed') return { kind: 'lapsed', questionId, withinMs: heard.value.withinMs } as const;
      return yield* approve(request);
    });
    const openEntries = Effect.fnUntraced(function* (
      threadId: string,
    ): Effect.fn.Return<readonly ThreadQuestionEntry[], ThreadBorderFailed> {
      const ofRun = yield* openQuestionsOf(store, threadId, yield* ledger.activeRun(threadId));
      const standalone = (yield* recorded(threadId, approvalScope(threadId))).filter((entry) => entry.status === 'open');
      return [...ofRun, ...standalone];
    });
    const rewritten = Effect.fnUntraced(function* (threadId: string, runId: string, entry: ThreadQuestionEntry, decidedBy: string) {
      const waiter = waiters.get(waiterKey(threadId, entry.questionId));
      if (waiter !== undefined) waiters.set(waiterKey(threadId, entry.questionId), { ...waiter, entry });
      yield* commit(threadId, runId, entry, `question:${entry.questionId}:${decidedBy}`);
    });
    const answering = yield* makeRoutedAnswers({ recorded, locked, commit });
    const decide: Context.Service.Shape<typeof Questions>['decide'] = (request) =>
      locked(
        request.threadId,
        Effect.gen(function* () {
          const { runId, entry } = yield* located(request.threadId, request.questionId);
          if (entry === null || entry.status !== 'open') return 'unknown' as const;
          if (entry.approver !== request.caller) return 'not-the-approver' as const;
          yield* rewritten(request.threadId, runId, { ...entry, decision: { by: request.caller, note: request.note } }, 'decided');
          return 'decided' as const;
        }),
      );
    const decline: Context.Service.Shape<typeof Questions>['decline'] = (request) =>
      locked(
        request.threadId,
        Effect.gen(function* () {
          const { runId, entry } = yield* located(request.threadId, request.questionId);
          if (entry === null || entry.status !== 'open') return 'unknown' as const;
          if (entry.approver !== request.caller) return 'not-the-approver' as const;
          const { approver: _left, ...rest } = entry;
          yield* rewritten(request.threadId, runId, { ...rest, declinedBy: request.caller }, 'declined');
          return 'declined' as const;
        }),
      );
    const reroute = (threadId: string): Effect.Effect<void, ThreadBorderFailed> =>
      locked(
        threadId,
        Effect.gen(function* () {
          for (const entry of yield* openEntries(threadId)) {
            const next = yield* routed(threadId, entry);
            if (next.approver !== entry.approver) yield* rewritten(threadId, entry.runId, next, 'rerouted');
            yield* announced(threadId, next);
          }
        }),
      );
    const holds = Effect.fnUntraced(function* (threadId: string, questionId: string) {
      const { entry, waiter } = yield* located(threadId, questionId);
      if (entry === null || entry.status !== 'open') return false;
      return waiter !== undefined || entry.action !== undefined || routedEntry(entry) || (yield* hostedThread(threadId)) !== null;
    });
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'routed questions',
      handle: (event) => answering.close(event.threadId, event.runId, endedWhileOpen(event.status, event.failureReason)),
    });
    const questions = Questions.of({
      approve,
      decide,
      decline,
      reroute,
      ask: Effect.fnUntraced(function* (asking) {
        const found = yield* posed(asking);
        if (found.kind === 'unasked') return null;
        if (found.kind === 'refused') return { refused: found.refused };
        if (found.kind === 'settled') return found.outcome;
        const outcome = Deferred.await(found.waiter.outcome);
        if (asking.stopped === undefined) return yield* outcome;
        const { entry } = found.waiter;
        const cleared = (called: AgentToolStop) =>
          locked(
            asking.threadId,
            Effect.gen(function* () {
              const standing = yield* located(asking.threadId, entry.questionId);
              if (standing.entry?.status !== 'open') return yield* outcome;
              const stop = { kind: 'cleared', reason: called.reason, refusal: called.refusal } as const;
              yield* settle(asking.threadId, standing.waiter, standing.entry, standing.runId, 'cleared', undefined, stop);
              return stop;
            }),
          );
        return yield* Effect.raceFirst(
          outcome,
          Effect.flatMap(asking.stopped, (called) => Effect.uninterruptible(cleared(called))),
        );
      }),
      answer: Effect.fnUntraced(function* (threadId, questionId, answers, call) {
        const { runId, entry } = yield* located(threadId, questionId);
        if (entry !== null && routedEntry(entry)) {
          return yield* keyedAnswer(
            threadId,
            questionId,
            answers,
            call,
            Effect.gen(function* () {
              if (entry.status !== 'open') return null;
              const asks = yield* answering.asksOf(threadId, entry.route);
              return asks === null ? null : yield* answering.deliver(threadId, runId, entry, asks, answers);
            }),
          );
        }
        const hosted = yield* locked(
          threadId,
          Effect.gen(function* () {
            const standing = yield* located(threadId, questionId);
            const owned =
              standing.entry !== null &&
              (standing.waiter !== undefined ||
                standing.entry.action !== undefined ||
                isApprovalScope(standing.runId) ||
                (yield* hostedThread(threadId)) !== null);
            if (!owned) return Option.none();
            return Option.some(yield* keyedAnswer(threadId, questionId, answers, call, answeredIn(threadId, questionId, answers)));
          }),
        );
        return Option.isSome(hosted) ? hosted.value : yield* parked.answer(threadId, questionId, answers, call);
      }),
      open: (threadId) => locked(threadId, openEntries(threadId)),
      holds,
      withdraw: (threadId, toolCallId, reason) =>
        locked(
          threadId,
          Effect.gen(function* () {
            const scope = approvalScope(threadId);
            const asked = (yield* recorded(threadId, scope)).filter(
              (entry) =>
                entry.status === 'open' && entry.action === undefined && entry.toolCalls.some((call) => call.toolCallId === toolCallId),
            );
            for (const entry of asked) {
              const waiter = waiters.get(waiterKey(threadId, entry.questionId));
              yield* settle(threadId, waiter, entry, scope, 'cleared', undefined, { kind: 'cleared', reason });
            }
          }),
        ),
      close: (threadId, runId, reason) =>
        Effect.andThen(
          parked.clear(threadId, runId, reason),
          locked(
            threadId,
            Effect.gen(function* () {
              deadlines.disarm(runId);
              const hosting = (yield* hostedThread(threadId)) !== null;
              const open = (yield* recorded(threadId, runId)).filter(
                (entry) =>
                  entry.status === 'open' && !routedEntry(entry) && (hosting || waiters.has(waiterKey(threadId, entry.questionId))),
              );
              for (const entry of open) {
                const waiter = waiters.get(waiterKey(threadId, entry.questionId));
                waiters.delete(waiterKey(threadId, entry.questionId));
                if (waiter !== undefined) yield* Deferred.fail(waiter.outcome, new ThreadCallBroke({ cause: new Error(reason) }));
                yield* commit(
                  threadId,
                  runId,
                  {
                    ...entry,
                    status: 'cleared',
                    updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
                  },
                  `question:${entry.questionId}:cleared`,
                );
              }
              if (open.length > 0) yield* staged(threadId, runId);
            }),
          ),
        ),
    });
    return Context.make(Questions, questions).pipe(Context.add(QuestionIntake, parked.intake));
  }),
);
