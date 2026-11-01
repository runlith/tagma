import type { ModelSwitches } from '@runlith/llm/models/description';
import { Context, Effect } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import type { ThreadCompactionEntry } from '../../transcript/entries';
import type { ThreadRunRow } from '../rows';
import type { TransportCapabilities } from '../record';
import { type ThreadHistoryFold } from '../events';
import { type ThreadCompactionRequest } from '../inboxItems';
import type { ThreadCompactionPoint, ThreadInboxItemValues } from '../storage/inbox';
import type { ThreadSummarizerSelection, ThreadSummarizing } from '../compaction/summarizer';
import type { ThreadCompactionSettlement } from '../compaction/settlement';
import { type ThreadBorderFailed } from '../ThreadBorder';
import { type ThreadRunStartKey } from '../storage/runs';

export type ThreadCompactionTarget = {
  readonly id: string;
  readonly agentId: string;
  readonly ownerId: string;
  readonly account: string | null;
  readonly cacheGroup: string;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
  readonly history: readonly Message[];
  readonly capabilities: TransportCapabilities;
};

export type ThreadCompactionRunInput = {
  readonly thread: ThreadCompactionTarget;
  readonly keep?: string;
  readonly mode?: ThreadCompactionEntry['mode'];
  readonly summarizing?: ThreadSummarizing;
  readonly releases?: Effect.Effect<void, ThreadBorderFailed>;
  readonly recovery?: true;
  readonly continuation?: ThreadInboxItemValues;
  readonly requests?: { readonly ids: readonly string[]; readonly alone: boolean };
  readonly accepting?: readonly ThreadInboxItemValues[];
  readonly startKey?: ThreadRunStartKey;
};

export type ThreadCompactAsk = {
  readonly keep?: string;
  readonly mode?: ThreadCompactionEntry['mode'];
  readonly at?: ThreadCompactionPoint;
  readonly summarizer?: ThreadSummarizerSelection;
  readonly startKey?: ThreadRunStartKey;
};

export type ThreadCompactionAsked =
  | ({ readonly status: 'started' } & ThreadCompactionOpened)
  | { readonly status: 'joined'; readonly runId: string }
  | { readonly status: 'requested'; readonly request: ThreadCompactionRequest; readonly runId: string };

export type ThreadCompactionAhead = {
  readonly requestId: string;
  readonly itemId: string;
  readonly runId: string | null;
  readonly started: boolean;
};

export type ThreadCompactionTaken = {
  readonly runId: string;
  readonly ids: readonly string[];
};

export type ThreadCompactionOpened = {
  readonly run: ThreadRunRow;
  readonly done: Effect.Effect<void, ThreadBorderFailed>;
};

export class ThreadCompactionRuns extends Context.Service<
  ThreadCompactionRuns,
  {
    opening(input: ThreadCompactionRunInput, run: ThreadRunRow): ThreadCompactionEntry;
    work(
      input: ThreadCompactionRunInput,
      run: ThreadRunRow,
      held: readonly ThreadCompactionRequest[],
    ): Effect.Effect<Effect.Effect<void, ThreadBorderFailed>, ThreadBorderFailed>;
    recordEntry(
      threadId: string,
      compaction: ThreadCompactionEntry,
      folded?: ThreadHistoryFold,
      taken?: ThreadCompactionTaken,
    ): Effect.Effect<void, ThreadBorderFailed>;
    settle(
      threadId: string,
      settlement: ThreadCompactionSettlement,
      compaction: ThreadCompactionEntry,
      taken?: ThreadCompactionTaken,
    ): Effect.Effect<boolean, ThreadBorderFailed>;
    foldPruning(threadId: string, settlement: ThreadCompactionSettlement): Effect.Effect<boolean, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadCompactionRuns') {}
