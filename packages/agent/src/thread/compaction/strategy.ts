import type { ModelSwitches } from '@runlith/llm/models/description';
import type { Effect } from 'effect';
import type {
  ThreadCompactionConflictError,
  ThreadCompactionExhaustedError,
  ThreadCompactionOffError,
  ThreadNoSummarizerError,
  ThreadSummaryFailedError,
} from '../storage/compaction';
import type { CompactionSummary } from '@runlith/llm/schema/compaction';
import type { Usage } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';

export type ThreadCompactionSegment = {
  readonly threadId: string;
  readonly runId?: string;
  readonly ownerId: string;
  readonly account?: string;
  readonly cacheGroup?: string;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
  readonly messages: readonly Message[];
  readonly alreadyCovered: number;
  readonly coveredMessageCount: number;
  readonly priorSummary: string | null;
  readonly keep?: string;
  usableTokens(plannedOutputTokens: number): number;
  readonly summaryBudgetTokens: number;
  readonly stallMs?: number;
};

export type ThreadCompactionSummary = {
  readonly coveredMessageCount: number;
  readonly summary: string;
  readonly usage: Usage | null;
  readonly context?: CompactionSummary;
  readonly account?: string;
};

export type ThreadCompactionPasses = {
  readonly boundaries: readonly number[] | null;
  readonly inputTokens: number;
};

export interface ThreadCompactionStrategy {
  summarize(segment: ThreadCompactionSegment): Effect.Effect<ThreadCompactionSummary, ThreadCompactionRefused>;
  passes?(segment: ThreadCompactionSegment): ThreadCompactionPasses;
}

export type ThreadCompactionRefused =
  | ThreadCompactionConflictError
  | ThreadCompactionExhaustedError
  | ThreadCompactionOffError
  | ThreadNoSummarizerError
  | ThreadSummaryFailedError;
