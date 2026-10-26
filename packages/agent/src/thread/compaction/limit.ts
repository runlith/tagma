import { Schema } from 'effect';
import type { ModelCapacity } from '@runlith/llm/models/description';
import type { TransportCapabilities } from '../record';
import type { ThreadContextReading } from '../rows';
import { type ResolvedCompactionTrigger, type ThreadCompactionPolicy, threadUsableTokens } from './policy';

export const ThreadCompactionThreshold = Schema.Struct({
  at: Schema.Number,
  strategy: Schema.Literals(['percent', 'reserve-output']),
  share: Schema.NullOr(Schema.Number),
  source: Schema.Literals(['override', 'row', 'global']),
});
export type ThreadCompactionThreshold = typeof ThreadCompactionThreshold.Type;

export const ThreadContextLimit = Schema.Struct({
  window: Schema.Number,
  compaction: Schema.NullOr(ThreadCompactionThreshold),
});
export type ThreadContextLimit = typeof ThreadContextLimit.Type;

export type ThreadLimitSubject = {
  readonly id: string;
  readonly projectId: number;
  readonly agentId: string;
  readonly provider: string;
  readonly model: string | null;
  readonly capabilities: TransportCapabilities;
  readonly contextReading: ThreadContextReading | null;
  readonly activeRun: { readonly id: string } | null;
};

export type ThreadLimitTable = ReadonlyMap<string, ThreadContextLimit>;

export function compactionThreshold(
  capacity: ModelCapacity,
  plannedOutputTokens: number,
  policy: ThreadCompactionPolicy,
  trigger: ResolvedCompactionTrigger,
): ThreadCompactionThreshold {
  return {
    at: threadUsableTokens(capacity, plannedOutputTokens, policy, trigger),
    strategy: trigger.strategy,
    share: trigger.strategy === 'percent' ? trigger.trigger : null,
    source: trigger.source,
  };
}

export type ThreadPromptUsage = { readonly inputTokens?: number | undefined; readonly totalTokens?: number | undefined };

export function occupiedTokens(usage: ThreadPromptUsage): number | null {
  return usage.inputTokens ?? usage.totalTokens ?? null;
}

export function limitTokens(limit: ThreadContextLimit): number {
  return limit.compaction?.at ?? limit.window;
}
