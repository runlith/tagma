import { Effect, type Context } from 'effect';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadPendingInteraction } from '../rows';
import { THREAD_RUN_AWAITING_QUESTION_STAGE, type ThreadRunStorage } from '../storage/runs';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { ThreadStore, ThreadTx, ThreadWriteTx } from '../ThreadPorts';
import { ROUTED_AWAITING, ROUTED_RESUMED, routedEntry } from './routedQuestions';
import { routedSlot } from './pendingSlot';

export type RoutedChange = {
  readonly slot: ThreadPendingInteraction;
  readonly participants: ((unit: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>) | null;
};

export const routedChange = Effect.fnUntraced(function* (
  store: Context.Service.Shape<typeof ThreadStore>,
  runs: ThreadRunStorage<ThreadTx, ThreadWriteTx>,
  threadId: string,
  slot: ThreadPendingInteraction,
  entry: ThreadQuestionEntry,
  tx: ThreadWriteTx,
  requiresOpen: boolean,
): Effect.fn.Return<RoutedChange | null, ThreadPortFailure> {
  const known = (yield* store.entriesOfRun(threadId, entry.runId, tx)).filter(
    (each): each is ThreadQuestionEntry & typeof each => each.type === 'question',
  );
  if (requiresOpen && known.findLast((each) => each.questionId === entry.questionId)?.status !== 'open') return null;
  const run = yield* runs.runById(entry.runId, tx);
  const running = run !== null && run.status === 'running';
  const next = yield* routedSlot(store, threadId, slot, entry, known, tx);
  if (!running) return { slot: next, participants: null };
  if (entry.status === 'open') {
    return { slot: next, participants: (unit) => Effect.asVoid(runs.parkRun(entry.runId, ROUTED_AWAITING, new Date(), unit)) };
  }
  const resumes =
    run.progress.stage === THREAD_RUN_AWAITING_QUESTION_STAGE &&
    !known.some((each) => each.questionId !== entry.questionId && each.status === 'open' && routedEntry(each));
  return { slot: next, participants: resumes ? (unit) => runs.writeProgress(entry.runId, ROUTED_RESUMED, new Date(), unit) : null };
});
