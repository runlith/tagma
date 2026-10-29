import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '@runlith/agent/thread/storage/runs';
import { sql, type SQL } from 'drizzle-orm';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { recordFacts } from '../../thread-record/facts.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { ThreadAsk } from '../contract/wire/list.js';
import { activeSessions, outcomeRunOf } from '../list/select.js';
import type { RunEnding, ThreadSummary } from '../list/summary.js';
import { entryField } from '../store/fields.js';
import { thread, threadRun, threadRunTally } from '../store/kernel.js';
import { threadSeen } from '../store/tables.js';

type Placed = { readonly eventId: string; readonly at: string };

export type ThreadStanding =
  | (Placed & { readonly kind: 'awaiting'; readonly runId: string | null; readonly ask: ThreadAsk })
  | (Placed & { readonly kind: 'failed'; readonly runId: string; readonly ending: RunEnding & { readonly status: 'failed' | 'cut' } })
  | (Placed & { readonly kind: 'finished'; readonly runId: string; readonly ending: RunEnding });

const failing = (ending: RunEnding): ending is RunEnding & { readonly status: 'failed' | 'cut' } =>
  ending.status === 'failed' || ending.status === 'cut';

export function standingOf(thread: ThreadSummary): ThreadStanding | null {
  if (thread.archivedAt !== null || thread.ownerId !== OPERATOR_PRINCIPAL) return null;
  const ask = thread.ask?.approver === undefined ? thread.ask : null;
  const run = thread.activeRun;
  if (ask !== null) {
    const at = ask.askedAt ?? (run?.startedAt ?? thread.createdAt).toISOString();
    if (ask.questionId.startsWith('approval:')) return { kind: 'awaiting', eventId: `approval:${ask.questionId}`, at, runId: null, ask };
    return run === null ? null : { kind: 'awaiting', eventId: `${run.id}:${ask.questionId}`, at, runId: run.id, ask };
  }
  const ending = thread.outcome;
  if (run !== null || ending === null || ending.isSeen) return null;
  const placed = { runId: ending.runId, at: ending.finishedAt.toISOString() };
  if (failing(ending)) return { ...placed, kind: 'failed', eventId: `${ending.runId}:failed`, ending };
  if (ending.status !== 'completed' || thread.parentThreadId !== null || thread.owes) return null;
  return { ...placed, kind: 'finished', eventId: `${ending.runId}:finished`, ending };
}

const ASKING = sql.raw('n.pending_interaction');

const asking: SQL = sql`(
  exists (
    select 1 from ${threadRun} r
     where r.thread_id = ${recordFacts.id} and r.status = 'running'
       and json_extract(r.progress, '$.stage') = ${THREAD_RUN_AWAITING_QUESTION_STAGE}
  )
  or exists (
    select 1 from ${thread} n
     where n.id = ${recordFacts.id}
       and ${entryField(ASKING, 'action')} is not null
       and ${entryField(ASKING, 'status')} = 'open'
  )
)`;

const endedUnseen: SQL = sql`(
  ${recordFacts.id} not in (select thread_id from ${activeSessions})
  and exists (
    select 1 from ${threadRun} t
     where t.id = ${outcomeRunOf(recordFacts.id)}
       and t.id is not (select s.run_id from ${threadSeen} s where s.thread_id = ${recordFacts.id})
       and (t.status in ('failed', 'cut') or (t.status = 'completed' and ${recordFacts.parentId} is null))
  )
)`;

export const standingDriven: SQL = sql`(
  ${recordFacts.id} in (
    select t.thread_id from ${threadRunTally} t where t.unseen = 1
    union
    select r.thread_id from ${threadRun} r
     where r.status = 'running' and json_extract(r.progress, '$.stage') = ${THREAD_RUN_AWAITING_QUESTION_STAGE}
    union
    select n.id from ${thread} n where ${entryField(ASKING, 'action')} is not null
  )
  and (${asking} or ${endedUnseen})
)`;

export function standingSignal(state: NativeThreadState): string {
  const run = state.activeRun;
  const session = state.harness?.session;
  const parts = [
    run?.id,
    run?.progress.stage,
    state.latestRun?.id,
    state.latestRun?.status,
    session?.id,
    session?.state,
    pendingSignal(state.thread.pendingInteraction),
  ];
  return parts.map((part) => part ?? '').join('|');
}

function pendingSignal(pending: NativeThreadState['thread']['pendingInteraction']): string | undefined {
  if (pending === null) return undefined;
  return `${pending.questionId}:${pending.status}:${pending.approver ?? ''}:${pending.questions.map((prompt) => prompt.id).join(',')}`;
}
