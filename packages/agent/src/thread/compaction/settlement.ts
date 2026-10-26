import { Effect } from 'effect';
import type { Usage } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { ThreadWriteTx } from '../ThreadPorts';
import type { ThreadCheckpointWrite, ThreadCompactionStorage, ThreadPrunedToolCall } from '../storage/compaction';
import { type ThreadPruning, retiredMarks } from './prune';

export type ThreadHistoryReplacement = {
  readonly keepFrom: number;
  readonly messages: readonly Message[];
};

export type ThreadCompactionSettle = (fold: ThreadHistoryReplacement, tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>;

export type ThreadCompactionSettlement = {
  readonly threadId: string;
  readonly checkpoint?: ThreadCheckpointWrite;
  readonly replaced: ThreadHistoryReplacement;
  readonly prunedToolCalls: readonly ThreadPrunedToolCall[];
  readonly retiredToolCalls: readonly string[];
  covers(lockedHistory: readonly Message[]): boolean;
};

export type ThreadPrefixDigest = (messages: readonly Message[], count: number) => string | null;

export function pruningSettlement(
  threadId: string,
  pruning: ThreadPruning,
  stored: readonly Message[],
  digest: ThreadPrefixDigest,
): ThreadCompactionSettlement | undefined {
  if (!pruning.foldsRecord) return undefined;
  const recordHash = digest(stored, stored.length);
  if (recordHash === null) return undefined;
  return {
    threadId,
    replaced: { keepFrom: stored.length, messages: pruning.stored },
    prunedToolCalls: pruning.marks,
    retiredToolCalls: [],
    covers: (lockedHistory) => digest(lockedHistory, stored.length) === recordHash,
  };
}

export function foldSettlement(input: {
  threadId: string;
  sourceRunId: string | null;
  history: readonly Message[];
  covered: number;
  head: readonly Message[];
  summary: string;
  usage: Usage | null;
  pruning: ThreadPruning;
  digest: ThreadPrefixDigest;
}): ThreadCompactionSettlement | undefined {
  const { history, covered, digest } = input;
  const coveredPrefixHash = digest(history, covered);
  if (coveredPrefixHash === null) return undefined;
  const foldsTail = input.pruning.foldsRecord;
  const recordHash = foldsTail ? digest(history, history.length) : null;
  const retired = retiredMarks(input.pruning.cleared, history, covered);
  const retiring = new Set(retired);
  return {
    threadId: input.threadId,
    checkpoint: {
      threadId: input.threadId,
      sourceRunId: input.sourceRunId,
      coveredMessageCount: covered,
      coveredPrefixHash,
      summary: input.summary,
      usage: input.usage,
    },
    replaced: foldsTail
      ? { keepFrom: history.length, messages: [...input.head, ...input.pruning.stored.slice(covered)] }
      : { keepFrom: covered, messages: input.head },
    prunedToolCalls: input.pruning.marks.filter((call) => !retiring.has(call.toolCallId)),
    retiredToolCalls: retired,
    covers: (lockedHistory) =>
      digest(lockedHistory, covered) === coveredPrefixHash && (recordHash === null || digest(lockedHistory, history.length) === recordHash),
  };
}

export const settleIn = Effect.fnUntraced(function* <TWrite>(
  checkpoints: ThreadCompactionStorage<TWrite>,
  settlement: ThreadCompactionSettlement,
  tx: TWrite,
): Effect.fn.Return<void, ThreadPortFailure> {
  const checkpoint = settlement.checkpoint;
  if (checkpoint) yield* checkpoints.writeCheckpointIn(checkpoint, tx);
  if (settlement.prunedToolCalls.length > 0) {
    yield* checkpoints.markToolCallsPrunedIn(settlement.threadId, settlement.prunedToolCalls, tx);
  }
  if (settlement.retiredToolCalls.length > 0) {
    yield* checkpoints.retirePrunedToolCallsIn(settlement.threadId, settlement.retiredToolCalls, tx);
  }
});
