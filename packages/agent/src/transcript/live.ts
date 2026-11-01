import { toJson } from '@runlith/utils/json';
import type { Schema } from 'effect';
import type { AgentSignalNotice, ToolConfirmationFact } from '../agent/contracts';
import type { AgentPhase } from '../agent/AgentPhase';
import type { ThreadAttachmentRef } from './attachments';
import type { ThreadTranscriptEntry } from './rows';
import type { ThreadEventDelta } from './eventFold';
import type { ThreadAttachment, ThreadInteractionPrompt, ThreadSignalEntry, WithdrawnWords } from './entries';
import { THREAD_TOOL_CONFIRM_KIND } from './parts';

export type FeedPosition = {
  readonly position: number;
  readonly seq: number;
};

export type ThreadContextEstimate = {
  readonly stepNumber: number;
  readonly tokens: number;
  readonly contextWindow: number | null;
};

export type LaunchBlock = { readonly threadId: string; readonly blocked: boolean };

export type ThreadLiveProgress = {
  readonly phase: AgentPhase | null;
  readonly estimate: ThreadContextEstimate | null;
};

export type ThreadOpenEntry = {
  readonly entry: ThreadTranscriptEntry;
  readonly from: number;
};

export type ThreadOpenChange =
  | { readonly op: 'put'; readonly entry: ThreadTranscriptEntry; readonly from: number }
  | { readonly op: 'append'; readonly id: string; readonly text: string }
  | { readonly op: 'drop'; readonly id: string }
  | { readonly op: 'progress'; readonly progress: ThreadLiveProgress | null };

export type ThreadOpenView = {
  readonly at: FeedPosition;
  readonly open: readonly ThreadOpenEntry[];
  readonly progress: ThreadLiveProgress | null;
};

export type ThreadOpenText = {
  readonly text: string;
  readonly from: number;
  readonly length: number;
};

export type ThreadLivePosition = {
  readonly incarnation: string;
  readonly runId: string | null;
  readonly at: FeedPosition;
};

export type ThreadLiveView = ThreadOpenView & ThreadLivePosition;

export type ThreadFeedSnapshot<TState> = TState & {
  readonly transcript: readonly ThreadTranscriptEntry[];
  readonly before: number | null;
  readonly open: readonly ThreadOpenEntry[];
  readonly progress: ThreadLiveProgress | null;
};

export type ThreadFeedEvent<TState> =
  | {
      readonly type: 'snapshot';
      readonly at: FeedPosition;
      readonly payload: { readonly status: 'loaded'; readonly snapshot: ThreadFeedSnapshot<TState> };
    }
  | {
      readonly type: 'resume';
      readonly at: FeedPosition;
      readonly payload: {
        readonly from: FeedPosition;
        readonly records: readonly ThreadEventDelta[];
        readonly open: readonly ThreadOpenEntry[];
        readonly progress: ThreadLiveProgress | null;
        readonly snapshot: TState;
      };
    }
  | {
      readonly type: 'state';
      readonly at: FeedPosition;
      readonly payload: { readonly records: readonly ThreadEventDelta[]; readonly snapshot: TState };
    }
  | { readonly type: 'open'; readonly at: FeedPosition; readonly change: ThreadOpenChange };

export type ThreadQueuedTurn = {
  readonly id: string;
  readonly runId: string;
  readonly kind?: 'compaction';
  readonly text: string;
  readonly keep?: string;
  readonly summarizer?: { readonly provider: string; readonly model: string; readonly reasoning?: string | null };
  readonly attachments?: readonly ThreadAttachmentRef[];
  readonly from?: string;
  readonly senderThreadId?: string;
  readonly senderProjectId?: number;
  readonly intent?: string;
  readonly notice?: AgentSignalNotice;
  readonly occurredAt: string;
};

export type ThreadWaitingAttachment = ThreadAttachmentRef & ThreadAttachment;

export type ThreadWaitingTurn = Omit<ThreadQueuedTurn, 'attachments'> & {
  readonly attachments?: readonly ThreadWaitingAttachment[];
};

export type ThreadPendingInput = {
  readonly queued: readonly ThreadWaitingTurn[];
  readonly steers: readonly ThreadWaitingTurn[];
  readonly arrived?: readonly ThreadSignalEntry[];
};

export type RunLife = 'idle' | 'working' | 'awaiting' | 'stalled';

export type RunOwnership = 'held' | 'stale-evidence' | 'recovering';

export type InputReceipt = {
  readonly key: string;
  readonly status: 'queued' | 'steered';
  readonly runId: string;
  readonly itemId: string;
  readonly occurredAt: string;
};

export const RUN_END_STATUSES = ['completed', 'failed', 'aborted', 'cut'] as const;

export type RunEndStatus = (typeof RUN_END_STATUSES)[number];

export const RUN_ENDINGS = [...RUN_END_STATUSES, 'withdrawn'] as const;

export type RunTerminalStatus = (typeof RUN_ENDINGS)[number];

export type RunStatusEnding = {
  readonly runId: string;
  readonly status: RunTerminalStatus;
  readonly stoppedBy: 'reader' | 'parent' | 'agent' | 'model' | null;
  readonly failureReason: string | null;
  readonly finishedAt: string;
  readonly notification: 'confirmed' | 'claimed' | 'retry-wait' | 'notification-exhausted';
  readonly words?: WithdrawnWords;
};

export const RUN_STAGES = [
  'starting',
  'running',
  'streaming',
  'compacting',
  'resuming',
  'awaiting-question',
  'completed',
  'failed',
  'aborted',
  'cut',
] as const;

export type RunStage = (typeof RUN_STAGES)[number];

export type RunHalt = { readonly reason: string };

export const WORDS_WAITS = ['archived', 'launch-refused', 'words-unsettled', 'composer-draft'] as const;

export type WordsWait = (typeof WORDS_WAITS)[number];

export type RunStatus = {
  readonly threadId: string;
  readonly runId: string | null;
  readonly life: RunLife;
  readonly stage: RunStage | null;
  readonly openQuestions: readonly string[];
  readonly since: string | null;
  readonly ownership?: RunOwnership;
  readonly halt?: RunHalt;
  readonly ending?: RunStatusEnding;
  readonly launchBlocked?: true;
  readonly wordsWait?: WordsWait;
  readonly receipts: readonly InputReceipt[];
};

export type StatusRow =
  | { readonly threadId: string; readonly outcome: 'found'; readonly status: RunStatus }
  | { readonly threadId: string; readonly outcome: 'not-found' | 'foreign-owner' };

export type ThreadSnapshotOf<TState> = TState &
  ThreadTranscriptView & {
    readonly live: ThreadOpenView;
  };

export type ThreadResumeOf<TState> = {
  readonly state: TState;
  readonly deltas: readonly ThreadEventDelta[];
  readonly live: ThreadOpenView;
};

export type ThreadTranscriptView = {
  readonly transcript: readonly ThreadTranscriptEntry[];
  readonly before: number | null;
};

export type ToolConfirmationPresentation = {
  toolName: string;
  facts?: readonly ToolConfirmationFact[];
  consequence?: string;
  intent?: 'destructive';
  asked?: readonly string[];
};

export function toolConfirmationData(presentation: ToolConfirmationPresentation): { readonly [key: string]: Schema.Json } {
  return toJson(presentation) as { readonly [key: string]: Schema.Json };
}

export function toolConfirmationPresentation(prompt: ThreadInteractionPrompt): ToolConfirmationPresentation | null {
  if (prompt.kind !== THREAD_TOOL_CONFIRM_KIND || !prompt.data) return null;
  return prompt.data as ToolConfirmationPresentation;
}
