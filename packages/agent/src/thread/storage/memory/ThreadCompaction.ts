import type { ThreadCompactionStorage } from '../compaction';
import type { ThreadCompactionCheckpointRow } from '../../rows';
import { uuidv7 } from 'uuidv7';
import type { MemoryStorageInput } from './state';
import { attempt } from './attempt';
import type { MemoryTx } from './units';

export function makeMemoryCompaction({ memory }: MemoryStorageInput): ThreadCompactionStorage<MemoryTx> {
  const checkpointsOf = (threadId: string): readonly ThreadCompactionCheckpointRow[] =>
    [...memory.checkpoints.values()].filter((row) => row.threadId === threadId);
  return {
    latestCheckpoint: (threadId) => attempt('latestCheckpoint', () => memory.read(undefined, () => checkpointsOf(threadId).at(-1) ?? null)),
    prunedToolCalls: (threadId) =>
      attempt('prunedToolCalls', () => memory.read(undefined, () => new Set(memory.pruned.get(threadId)?.keys()))),
    prunedToolCallVolume: (threadId) =>
      attempt('prunedToolCallVolume', () =>
        memory.read(undefined, () => {
          const held = memory.pruned.get(threadId);
          return { count: held?.size ?? 0, tokens: [...(held?.values() ?? [])].reduce((sum, tokens) => sum + tokens, 0) };
        }),
      ),
    compactionCount: (threadId) => attempt('compactionCount', () => memory.read(undefined, () => checkpointsOf(threadId).length)),
    markToolCallsPrunedIn: (threadId, calls, tx) =>
      attempt('markToolCallsPrunedIn', () => {
        const thread = memory.held(threadId);
        if (calls.length === 0 || !thread) return;
        const held = new Map(memory.pruned.get(threadId));
        for (const call of calls) if (!held.has(call.toolCallId)) held.set(call.toolCallId, call.tokens);
        tx.put(memory.pruned, threadId, held);
        tx.keep(thread);
        thread.foldRev += 1;
      }),
    retirePrunedToolCallsIn: (threadId, toolCallIds, tx) =>
      attempt('retirePrunedToolCallsIn', () => {
        const current = memory.pruned.get(threadId);
        const thread = memory.held(threadId);
        if (toolCallIds.length === 0 || !current || !thread) return;
        const held = new Map(current);
        for (const id of toolCallIds) held.delete(id);
        tx.put(memory.pruned, threadId, held);
        tx.keep(thread);
        thread.foldRev += 1;
      }),
    writeCheckpointIn: (input, tx) =>
      attempt('writeCheckpointIn', () => {
        const existing = checkpointsOf(input.threadId).find((row) => row.coveredPrefixHash === input.coveredPrefixHash);
        if (existing) return existing;
        const thread = memory.held(input.threadId);
        if (!thread) throw new Error(`Thread ${input.threadId} holds no log to checkpoint.`);
        const row: ThreadCompactionCheckpointRow = {
          id: uuidv7(),
          threadId: input.threadId,
          sourceRunId: input.sourceRunId,
          coveredMessageCount: input.coveredMessageCount,
          coveredPrefixHash: input.coveredPrefixHash,
          summary: input.summary,
          usage: input.usage,
          createdAt: tx.now(),
        };
        tx.put(memory.checkpoints, row.id, row);
        tx.keep(thread);
        thread.foldRev += 1;
        return row;
      }),
  };
}
