import { Effect } from 'effect';
import { estimateThreadTokens } from './measurement';
import { serializeThreadMessage } from './segmentText';
import type { ThreadCompactionSegment, ThreadCompactionStrategy, ThreadCompactionSummary } from './strategy';

export interface ThreadDigestStrategy extends ThreadCompactionStrategy {
  summarize(segment: ThreadCompactionSegment): Effect.Effect<ThreadCompactionSummary>;
}

export const makeThreadDigestStrategy = (): ThreadDigestStrategy => ({
  summarize: (segment) =>
    Effect.sync(() => {
      const budget = segment.summaryBudgetTokens;
      let head = segment.priorSummary ?? '';
      let headTokens = estimateThreadTokens(head);
      if (headTokens > budget) {
        head = `${head.slice(0, budget * 4)}\n[truncated]`;
        headTokens = estimateThreadTokens(head);
      }
      const blocks = segment.messages
        .slice(segment.alreadyCovered, segment.coveredMessageCount)
        .map((message) => ({ text: serializeThreadMessage(message), tokens: 0 }))
        .filter((block) => block.text.length > 0)
        .map((block) => ({ ...block, tokens: estimateThreadTokens(block.text) }));
      let keptTokens = blocks.reduce((sum, block) => sum + block.tokens, 0);
      let dropFrom = 0;
      while (dropFrom < blocks.length && headTokens + keptTokens > budget) {
        keptTokens -= blocks[dropFrom]!.tokens;
        dropFrom += 1;
      }
      const kept = blocks.slice(dropFrom).map((block) => block.text);
      const parts = [...(head ? [head] : []), ...(dropFrom > 0 ? ['[truncated]'] : []), ...kept];
      return {
        coveredMessageCount: segment.coveredMessageCount,
        summary: parts.length > 0 ? parts.join('\n\n') : '[truncated]',
        usage: null,
      };
    }),
});
