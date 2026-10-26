import { Context, Effect, Layer } from 'effect';
import { estimateThreadTokens } from '../compaction/measurement';
import { threadPruneProtection } from '../compaction/prune';
import { compositionEntryId } from '../../transcript/entryNames';
import { coreEntry } from '../../transcript/kinds';
import type { ThreadRunRow } from '../rows';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadStore } from '../ThreadPorts';
import { ThreadCompactor } from './ThreadCompaction';
import { ThreadRunLedger } from './ThreadRunLedger';
import {
  declaredToolSchemas,
  threadRequestComposition,
  type ThreadCompositionLedger,
  type ThreadRequestComposition,
} from '../composition/requestComposition';

export class ThreadComposition extends Context.Service<
  ThreadComposition,
  {
    of(threadId: string): Effect.Effect<ThreadRequestComposition, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadComposition') {}

export const threadCompositionLayer: Layer.Layer<ThreadComposition, never, ThreadCompactor | ThreadRunLedger | ThreadStore> = Layer.effect(
  ThreadComposition,
  Effect.gen(function* () {
    const compactor = yield* ThreadCompactor;
    const ledger = yield* ThreadRunLedger;
    const store = yield* ThreadStore;

    return {
      of: Effect.fnUntraced(function* (threadId) {
        const thread = yield* store.find(threadId);
        if (!thread) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });

        const [runs, cleared, compactions, policy] = yield* Effect.all(
          [ledger.runsOf(threadId), compactor.clearedVolume(threadId), compactor.compactionCount(threadId), compactor.policy({ threadId })],
          { concurrency: 'unbounded' },
        );

        const newestRun = runs.at(-1);
        const entry = newestRun ? yield* store.entryById(threadId, compositionEntryId(newestRun.id)) : undefined;
        const composition = entry !== undefined && coreEntry(entry) && entry.type === 'composition' ? entry : null;
        const fixed = composition ? { systemChars: composition.system.chars, tools: composition.tools.each } : null;

        const { capacity } = yield* compactor.served(thread.provider, thread.model);
        const protection = threadPruneProtection(capacity, policy);
        const reading = thread.contextReading;
        const billedInput = reading && !reading.stale ? (reading.usage.inputTokens ?? reading.usage.totalTokens ?? null) : null;

        return threadRequestComposition({
          threadId,
          history: thread.history,
          fixed,
          clearedMarker: compactor.clearedToolOutputText(),
          cleared,
          share: policy.toolPruneProtectShare,
          protectTokens: protection.protectTokens,
          nextPruneAtTokens: protection.protectTokens + protection.minimumTokens,
          ledger: ledgerOf(runs, compactions),
          billedInput,
          estimatedTotal:
            billedInput ??
            estimateThreadTokens(thread.history, policy.imageTokens) +
              Math.round(
                ((fixed?.systemChars ?? 0) +
                  declaredToolSchemas(thread.history, fixed?.tools ?? []).declared.reduce((sum, tool) => sum + tool.chars, 0)) /
                  4,
              ),
        });
      }),
    };
  }),
);

function ledgerOf(runs: readonly ThreadRunRow[], compactions: number): Omit<ThreadCompositionLedger, 'toolCalls'> {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  for (const run of runs) {
    const usage = run.usage;
    if (!usage) continue;
    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
    cacheReadTokens += usage.cacheReadInputTokens ?? 0;
    cacheWriteTokens += usage.cacheWriteInputTokens ?? 0;
  }
  return { runs: runs.length, compactions, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}
