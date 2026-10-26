import { Clock, Effect } from 'effect';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '../../transcript/entries';
import { actDigest } from '../keyed';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadStore } from '../ThreadPorts';
import type { AskDelivery, TransportAsks } from '../transport/contract';
import { Transports } from '../transport/Transports';
import { routedEntry, unofferedAnswer, withoutAnswers } from './routedQuestions';
import { ThreadAnswerInvalidError, ThreadInteractionConflictError } from './ThreadQuestion';

type Recorded = (threadId: string, runId: string) => Effect.Effect<readonly ThreadQuestionEntry[], ThreadBorderFailed>;

type Locked = <A, E>(threadId: string, work: Effect.Effect<A, E>) => Effect.Effect<A, E>;

type Committed = (
  threadId: string,
  runId: string,
  entry: ThreadQuestionEntry,
  decidedBy: string,
  requiresOpen?: boolean,
) => Effect.Effect<boolean, ThreadBorderFailed>;

const SENDING = 'The answer is being sent to the CLI.';
const UNKNOWN = 'Whether the CLI received this answer is not known; it is kept and never sent again.';
const UNWRITTEN = 'The CLI did not take this answer; it can be answered again.';
const TAKEN = 'Another answer to this question is being sent or may already have reached the CLI, so this one is not sent.';
const GONE = 'The CLI no longer shows this question; the answer is kept until it is asked again.';

export const makeRoutedAnswers = Effect.fnUntraced(function* ({
  recorded,
  locked,
  commit,
}: {
  readonly recorded: Recorded;
  readonly locked: Locked;
  readonly commit: Committed;
}) {
  const store = yield* ThreadStore;
  const transports = yield* Transports;

  const settled = (
    threadId: string,
    runId: string,
    before: ThreadQuestionEntry,
    given: ThreadQuestionEntry,
    outcome: AskDelivery,
    reason?: string,
  ): Effect.Effect<boolean, ThreadBorderFailed> =>
    locked(
      threadId,
      Effect.gen(function* () {
        const standing = (yield* recorded(threadId, runId)).findLast((each) => each.questionId === before.questionId);
        if (standing === undefined || standing.status !== 'open' || standing.deliveryUnknown !== true) return false;
        const at = new Date(yield* Clock.currentTimeMillis).toISOString();
        const { deliveryUnknown: _sending, deliveryNote: _was, ...settledEntry } = standing;
        const next: ThreadQuestionEntry =
          outcome === 'unknown'
            ? { ...standing, deliveryNote: reason ?? UNKNOWN, updatedAt: at }
            : outcome === 'delivered'
              ? { ...settledEntry, status: 'answered', answers: given.answers ?? settledEntry.answers, updatedAt: at }
              : outcome === 'gone'
                ? { ...settledEntry, deliveryNote: GONE, answers: given.answers ?? settledEntry.answers, updatedAt: at }
                : {
                    ...(before.answers === undefined ? withoutAnswers(settledEntry) : { ...settledEntry, answers: before.answers }),
                    deliveryNote: reason ?? UNWRITTEN,
                    updatedAt: at,
                  };
        return yield* commit(threadId, runId, next, `question:${before.questionId}:${next.status}:${at}`, true);
      }),
    );

  return {
    asksOf: Effect.fnUntraced(function* (threadId: string, route: string): Effect.fn.Return<TransportAsks | null, ThreadBorderFailed> {
      const row = yield* store.metadata(threadId);
      if (row === undefined) return null;
      const transport = yield* Effect.mapError(
        transports.of({ ...row.transport, adapter: route }),
        (cause) => new ThreadCallBroke({ cause }),
      );
      if (transport.asks === undefined) {
        return yield* new ThreadCallBroke({ cause: new Error(`Transport ${route} holds routed questions but registers no answer route.`) });
      }
      return transport.asks;
    }),

    deliver: Effect.fnUntraced(function* (
      threadId: string,
      runId: string,
      entry: ThreadQuestionEntry,
      asks: TransportAsks,
      answers: readonly ThreadInteractionAnswer[],
    ): Effect.fn.Return<{ readonly runId: string } | null, ThreadBorderFailed> {
      const invalid = unofferedAnswer(entry, answers);
      if (invalid !== null) {
        return yield* new ThreadCallBroke({
          cause: new ThreadAnswerInvalidError({ threadId, questionId: entry.questionId, reason: invalid }),
        });
      }
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      const claim = yield* locked(
        threadId,
        Effect.gen(function* () {
          const standing = (yield* recorded(threadId, runId)).findLast((each) => each.questionId === entry.questionId);
          if (standing === undefined || standing.status !== 'open') return null;
          if (standing.deliveryUnknown === true) {
            if (standing.answers !== undefined && actDigest(standing.answers) === actDigest(answers)) return 'sent' as const;
            return yield* new ThreadCallBroke({
              cause: new ThreadInteractionConflictError({ threadId, runId, questionId: entry.questionId, reason: TAKEN }),
            });
          }
          const given: ThreadQuestionEntry = { ...standing, answers, updatedAt: at };
          const sending: ThreadQuestionEntry = { ...given, deliveryUnknown: true, deliveryNote: SENDING };
          const claimed = yield* commit(threadId, runId, sending, `question:${entry.questionId}:answer:${actDigest(answers)}:${at}`, true);
          return claimed ? { before: standing, given } : null;
        }),
      );
      if (claim === null) return null;
      if (claim === 'sent') return { runId };
      const { before, given } = claim;
      const asked = yield* Effect.result(asks.answer(threadId, given, answers));
      if (asked._tag === 'Failure') {
        yield* settled(
          threadId,
          runId,
          before,
          given,
          'unknown',
          `Delivery stopped with an error and may have reached the CLI: ${String(asked.failure)}`,
        );
        return yield* Effect.fail(asked.failure);
      }
      const kept = yield* settled(threadId, runId, before, given, asked.success);
      return asked.success === 'gone' && !kept ? null : { runId };
    }),

    close: (threadId: string, runId: string, note: string): Effect.Effect<void, ThreadBorderFailed> =>
      locked(
        threadId,
        Effect.gen(function* () {
          const open = (yield* recorded(threadId, runId)).filter((entry) => entry.status === 'open' && routedEntry(entry));
          const at = new Date(yield* Clock.currentTimeMillis).toISOString();
          for (const entry of open) {
            yield* commit(
              threadId,
              runId,
              { ...withoutAnswers(entry), status: 'cleared', decision: { note }, updatedAt: at },
              `question:${entry.questionId}:cleared`,
            );
          }
        }),
      ),
  };
});
