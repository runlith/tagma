import { Effect } from 'effect';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ReportPlan, ReportResult } from '@runlith/agent/thread/run/lifecycle/RunReports';
import { questionEntryId } from '@runlith/agent/transcript/entryNames';
import { entryOf } from '@runlith/agent/transcript/kinds';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { NativeStorage } from '../../threads/contract/service/engine.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { TerminalJournal } from '../terminal/journal.js';
import { TERMINAL_ROUTE, type AskLedger } from './terminal.js';

export const openTerminalQuestions = (threads: NativeStorage['Service']['threads'], threadId: string, run: string) =>
  Effect.map(Effect.mapError(threads.openQuestionsOfRun(threadId, run), threadCallFailed), (entries) =>
    entries.filter((entry) => entry.route === TERMINAL_ROUTE),
  );

export function askLedger(
  sessions: HarnessSessionStore,
  journal: TerminalJournal,
  threads: NativeStorage['Service']['threads'],
  current: AskLedger['current'],
  reroute: (threadId: string) => Effect.Effect<void, HarnessFailure>,
  published: (threadId: string) => Effect.Effect<void, HarnessFailure>,
): AskLedger {
  const apply = (threadId: string, plan: ReportPlan): Effect.Effect<ReportResult, HarnessFailure> =>
    Effect.tap(
      sessions.change(
        threadId,
        (facet, unit) =>
          Effect.map(Effect.mapError(journal.apply(unit, [plan]), threadCallFailed), (results) => ({ facet, value: results[0]! })),
        journal.writes,
      ),
      (result) => (result.status === 'applied' ? published(threadId) : Effect.void),
    );
  const get: AskLedger['get'] = (run, questionId) =>
    Effect.map(Effect.mapError(threads.entryById(run.threadId, questionEntryId(run.id, [questionId])), threadCallFailed), (entry) =>
      entry !== undefined && entryOf('question')(entry) && entry.route === TERMINAL_ROUTE ? entry : null,
    );
  return {
    current,
    get,
    asked: Effect.fnUntraced(function* (run: ThreadRunRef, entry, evidence) {
      const result = yield* apply(run.threadId, journal.reports.asked(run, entry, evidence));
      if (result.status !== 'applied' && result.status !== 'replayed') return false;
      return (yield* get(run, entry.questionId))?.status === 'open';
    }),
    routed: reroute,
    resolved: (run, questionId, evidence, closing, note) =>
      Effect.asVoid(apply(run.threadId, journal.reports.resolved(run, questionId, evidence, closing, note))),
    open: (threadId, run) => openTerminalQuestions(threads, threadId, run.id),
  };
}
