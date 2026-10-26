import type { Effect } from 'effect';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { Message } from '@runlith/llm/schema/messages';
import type { ThreadSummarizerReason, ThreadSummarizerSkip } from '../../transcript/entries';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadNoSummarizerError } from '../storage/compaction';

export type ThreadSummarizerSelection = {
  readonly provider: string;
  readonly model: string;
  readonly reasoning?: string | null;
};

export type ResolvedSummarizer = {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string | null;
  readonly account?: string;
};

export type ThreadSummarizers =
  | { readonly kind: 'own'; readonly reason: 'never' | 'warm' | 'unchained' }
  | {
      readonly kind: 'chain';
      readonly reason: 'cold' | 'always' | 'foreign';
      readonly members: readonly ResolvedSummarizer[];
      readonly skipped: readonly ThreadSummarizerSkip[];
    }
  | { readonly kind: 'none'; readonly reason: 'cold' | 'always' | 'foreign'; readonly skipped: readonly ThreadSummarizerSkip[] };

export type ThreadSummarizerAsk = {
  readonly threadId: string;
  readonly runId?: string;
  readonly running: boolean;
};

export type ThreadSummarizerPort = (ask: ThreadSummarizerAsk) => Effect.Effect<ThreadSummarizers, ThreadPortFailure>;

export type ThreadSummarizing =
  | { readonly kind: 'own'; readonly reason: ThreadSummarizerReason }
  | {
      readonly kind: 'foreign';
      readonly reason: ThreadSummarizerReason;
      readonly members: readonly ResolvedSummarizer[];
      readonly skipped: readonly ThreadSummarizerSkip[];
    };

export const OWN_SUMMARIZING: ThreadSummarizing = { kind: 'own', reason: 'unchained' };

export function sameSummarizer(left: ThreadSummarizerSelection | undefined, right: ThreadSummarizerSelection | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.provider === right.provider && left.model === right.model && (left.reasoning ?? null) === (right.reasoning ?? null);
}

export function answersSummarizer(standing: ThreadSummarizerSelection | undefined, asked: ThreadSummarizerSelection | undefined): boolean {
  return asked === undefined || sameSummarizer(standing, asked);
}

export function ownSummarizer(
  thread: { readonly provider: string; readonly model: string | null },
  selection: ThreadSummarizerSelection,
): boolean {
  return selection.provider === thread.provider && selection.model === thread.model;
}

export function namedSummarizing(
  thread: { readonly provider: string; readonly model: string | null },
  named: ThreadSummarizerSelection,
): ThreadSummarizing {
  return ownSummarizer(thread, named)
    ? { kind: 'own', reason: 'named' }
    : {
        kind: 'foreign',
        reason: 'named',
        members: [{ provider: named.provider, model: named.model, reasoning: named.reasoning ?? null }],
        skipped: [],
      };
}

export function summarizingOf(
  threadId: string,
  answered: ThreadSummarizers,
  session?: { readonly provider: string; readonly model: string | null },
): ThreadSummarizing | ThreadNoSummarizerError {
  switch (answered.kind) {
    case 'own':
      return { kind: 'own', reason: answered.reason };
    case 'chain': {
      const first = answered.members[0];
      if (first === undefined) return new ThreadNoSummarizerError(threadId, answered.skipped);
      if (session === undefined) return { kind: 'foreign', reason: answered.reason, members: answered.members, skipped: answered.skipped };
      if (ownSummarizer(session, first)) return { kind: 'own', reason: answered.reason };
      const folded = answered.members.filter((member) => ownSummarizer(session, member));
      return {
        kind: 'foreign',
        reason: answered.reason,
        members: answered.members.filter((member) => !ownSummarizer(session, member)),
        skipped: [
          ...answered.skipped,
          ...folded.map((member) => ({ provider: member.provider, model: member.model, reason: 'not-callable' as const })),
        ],
      };
    }
    case 'none':
      return new ThreadNoSummarizerError(threadId, answered.skipped);
  }
}

export type ThreadCompactionEstimate = {
  readonly inputTokens: number;
  readonly passes: number | null;
};

export type ThreadCompactionEstimateInput = {
  readonly threadId: string;
  readonly ownerId: string;
  readonly account: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches | null;
  readonly fixedTokens: number;
  readonly history: readonly Message[];
  readonly keep?: string;
  readonly candidates: readonly ResolvedSummarizer[];
};

export type ThreadCompactionEstimates = {
  readonly own: ThreadCompactionEstimate;
  readonly candidates: readonly ThreadCompactionEstimate[];
};
