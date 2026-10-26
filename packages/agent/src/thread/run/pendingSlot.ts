import { Effect, type Context } from 'effect';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { ThreadStore, ThreadWriteTx } from '../ThreadPorts';
import type { ThreadPendingInteraction } from '../rows';
import { routedEntry } from './routedQuestions';

export type SlotReach = 'parked' | 'hosted' | 'standalone';

const APPROVAL_SCOPE = 'approvals:';
export const approvalScope = (threadId: string): string => `${APPROVAL_SCOPE}${threadId}`;
export const isApprovalScope = (runId: string): boolean => runId.startsWith(APPROVAL_SCOPE);

const forOperator = (entry: ThreadQuestionEntry): boolean => entry.approver === undefined;

const openApprovals = Effect.fnUntraced(function* (
  store: Context.Service.Shape<typeof ThreadStore>,
  threadId: string,
  tx: ThreadWriteTx,
  except?: string,
): Effect.fn.Return<readonly ThreadQuestionEntry[], ThreadPortFailure> {
  return (yield* store.openQuestionsOfRun(threadId, approvalScope(threadId), tx)).filter((entry) => entry.questionId !== except);
});

const nextApproval = Effect.fnUntraced(function* (
  store: Context.Service.Shape<typeof ThreadStore>,
  threadId: string,
  tx: ThreadWriteTx,
  except?: string,
): Effect.fn.Return<ThreadPendingInteraction, ThreadPortFailure> {
  const open = yield* openApprovals(store, threadId, tx, except);
  return open.find(forOperator) ?? open[0] ?? null;
});

export const slotAfter = Effect.fnUntraced(function* (
  store: Context.Service.Shape<typeof ThreadStore>,
  threadId: string,
  slot: ThreadPendingInteraction,
  entry: ThreadQuestionEntry,
  reach: SlotReach,
  tx: ThreadWriteTx,
): Effect.fn.Return<ThreadPendingInteraction, ThreadPortFailure> {
  const own = slot?.questionId === entry.questionId;
  if (entry.status !== 'open') {
    if (!own) return slot;
    return yield* nextApproval(store, threadId, tx, entry.runId === approvalScope(threadId) ? entry.questionId : undefined);
  }
  if (reach === 'parked') return entry;
  if (reach === 'hosted') return own ? entry : slot;
  if (own) return forOperator(entry) ? entry : ((yield* openApprovals(store, threadId, tx, entry.questionId)).find(forOperator) ?? entry);
  if (slot === null) return entry;
  return forOperator(entry) && isApprovalScope(slot.runId) && !forOperator(slot) ? entry : slot;
});

export const slotWithout = Effect.fnUntraced(function* (
  store: Context.Service.Shape<typeof ThreadStore>,
  threadId: string,
  slot: ThreadPendingInteraction,
  runId: string,
  tx: ThreadWriteTx,
): Effect.fn.Return<ThreadPendingInteraction, ThreadPortFailure> {
  if (slot === null || slot.runId !== runId) return slot;
  return runId === approvalScope(threadId) ? null : yield* nextApproval(store, threadId, tx);
});

export const routedSlot = Effect.fnUntraced(function* (
  store: Context.Service.Shape<typeof ThreadStore>,
  threadId: string,
  slot: ThreadPendingInteraction,
  entry: ThreadQuestionEntry,
  standing: readonly ThreadQuestionEntry[],
  tx: ThreadWriteTx,
): Effect.fn.Return<ThreadPendingInteraction, ThreadPortFailure> {
  const own = slot?.questionId === entry.questionId;
  if (entry.status === 'open') return own || slot === null || slot.runId !== entry.runId || slot.status !== 'open' ? entry : slot;
  if (!own) return slot;
  return (
    standing.find((each) => each.questionId !== entry.questionId && each.status === 'open' && routedEntry(each)) ??
    (yield* nextApproval(store, threadId, tx))
  );
});

export const isOpenQuestion = (
  slot: ThreadPendingInteraction | undefined,
  runId: string,
  questionId: string,
): slot is ThreadQuestionEntry =>
  slot?.type === 'question' && slot.runId === runId && slot.questionId === questionId && slot.status === 'open';
