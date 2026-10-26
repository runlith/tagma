import type { AgentPhase } from '@runlith/agent/AgentPhase';
import { type AgentSignalNotice, USER_MESSAGE_SIGNAL_TYPE } from '@runlith/agent/contracts';
import type { ThreadAttachment, ThreadFailureDiagnostics, ThreadSignalEntry } from '@runlith/agent/transcript/entries';
import type { RunStatus, ThreadWaitingTurn } from '@runlith/agent/transcript/live';
import type { ChatAttachment, ChatWordsSender } from '../entries';
import { wordsOf } from '../entryProjection';
import type { ChatLiveStatus } from '../liveStatus';
import type { ChatState, ChatThreadView } from '../wire/ChatConnection';

export type ChatQueuedAttachment = ChatAttachment & { readonly id?: string };

export type ChatQueuedTurnItem = {
  id: string;
  kind: 'turn' | 'compaction';
  text: string;
  attachments: readonly ChatQueuedAttachment[];
  sender: ChatWordsSender | null;
  intent: string | null;
  notice: AgentSignalNotice | null;
  removable: boolean;
  at: string;
};
export type ChatRunEnding = {
  kind: 'cut' | 'failed';
  runId: string;
  words: string | null;
  failure: ThreadFailureDiagnostics | null;
  finishedAt: string | null;
  provider: string | null;
  model: string | null;
  reasoning: string | null;
};

export const CHAT_QUEUE_PREVIEW_MAX = 120;

export function runEnding(state: ChatState<ChatThreadView>): ChatRunEnding | null {
  const ending = state.status.ending;
  if (state.status.runId !== null || ending === undefined) return null;
  if (ending.status !== 'cut' && ending.status !== 'failed') return null;
  const run = state.latestRun?.id === ending.runId ? state.latestRun : null;
  const words = ending.status === 'cut' ? (run?.progress.message ?? null) : ending.failureReason;
  return {
    kind: ending.status,
    runId: ending.runId,
    words: words?.trim() || null,
    failure: ending.status === 'failed' ? (run?.failure ?? null) : null,
    finishedAt: ending.finishedAt,
    provider: run?.provider ?? null,
    model: run?.model ?? null,
    reasoning: run?.reasoning ?? null,
  };
}

export function waitingItems(
  rows: readonly ThreadWaitingTurn[],
  arrived: readonly ThreadSignalEntry[] = [],
  address: (url: string) => string = (url) => url,
): readonly ChatQueuedTurnItem[] {
  const held = (attachment: ChatQueuedAttachment): ChatQueuedAttachment => ({ ...attachment, url: address(attachment.url) });
  if (arrived.length === 0) return rows.map((row) => waitingItem(row, held));
  return [...rows.map((row) => waitingItem(row, held)), ...arrived.map((entry) => arrivedItem(entry, held))].toSorted((one, other) =>
    one.at.localeCompare(other.at),
  );
}

export function ownWords(item: ChatQueuedTurnItem): boolean {
  return item.sender === null && item.intent === null;
}

function waitingItem(input: ThreadWaitingTurn, held: (attachment: ChatQueuedAttachment) => ChatQueuedAttachment): ChatQueuedTurnItem {
  const sender = input.from === undefined ? null : { name: input.from, threadId: input.senderThreadId, projectId: input.senderProjectId };
  return {
    id: input.id,
    kind: input.kind ?? 'turn',
    text: input.kind === 'compaction' ? (input.keep ?? '') : input.text,
    attachments: (input.attachments ?? []).map(held),
    sender,
    intent: sender === null ? null : (input.intent ?? null),
    notice: input.notice ?? null,
    removable: sender === null && (input.intent === undefined || input.intent === USER_MESSAGE_SIGNAL_TYPE),
    at: input.occurredAt,
  };
}

function arrivedItem(entry: ThreadSignalEntry, held: (attachment: ThreadAttachment) => ChatQueuedAttachment): ChatQueuedTurnItem {
  const words = wordsOf(entry);
  return {
    id: entry.id,
    kind: 'turn',
    text: entry.text,
    attachments: (entry.attachments ?? []).map(held),
    sender: words?.sender ?? null,
    intent: words?.sender === null ? null : entry.signalType,
    notice: entry.notice ?? null,
    removable: false,
    at: entry.occurredAt ?? '',
  };
}

export type RunVerdict = {
  readonly runId: string;
  readonly phase: ChatLiveStatus['phase'];
  readonly waiting: ChatLiveStatus['waiting'];
  readonly pulse: boolean;
  readonly alive: boolean;
  readonly startedAt: number | null;
  readonly phaseSince: number | null;
  readonly reason: string | null;
  readonly asOf: number | null;
};

export type FeedStill = 'lost' | 'broken' | 'closed';

export type FeedReading = { readonly kind: 'live' } | { readonly kind: FeedStill; readonly reason: string; readonly asOf: number | null };

export const LIVE_FEED: FeedReading = { kind: 'live' };

export function feedClock(reading: FeedReading, now: number): number {
  return reading.kind === 'live' || reading.asOf === null ? now : Math.min(now, reading.asOf);
}

export function runVerdict(
  status: RunStatus | null,
  reading: FeedReading,
  phase: AgentPhase | null,
  startedAt: number | null,
): RunVerdict | null {
  const runId = status?.runId ?? null;
  if (status === null || runId === null || reading.kind === 'closed') return null;
  const readable = reading.kind === 'live';
  const pulse = readable && (status.life === 'working' || status.life === 'stalled');
  const shown: ChatLiveStatus['phase'] =
    reading.kind === 'lost'
      ? 'reconnecting'
      : reading.kind === 'broken'
        ? 'unreadable'
        : status.life === 'awaiting'
          ? 'awaiting'
          : status.life === 'idle'
            ? 'unresponsive'
            : (phase?.phase ?? (status.stage === 'compacting' ? 'compacting' : 'working'));
  return {
    runId,
    phase: shown,
    waiting: readable && phase !== null && shown === phase.phase ? (phase.waiting ?? null) : null,
    pulse,
    alive: pulse || (readable && status.life === 'awaiting'),
    startedAt,
    phaseSince: pulse && phase !== null ? phase.since : null,
    reason: reading.kind === 'live' ? (status.halt?.reason ?? null) : reading.reason,
    asOf: reading.kind === 'live' ? null : reading.asOf,
  };
}
