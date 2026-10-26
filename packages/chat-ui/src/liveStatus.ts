import type { AgentPhase, AgentWaiting } from '@runlith/agent/AgentPhase';
import { type ChatStepLine, toolSettled, type ActivityEntry } from './activity';
import type { ChatEntry } from './entries';
import type { RunVerdict } from './session/FeedVerdicts';
import type { ChatStrings } from './strings';

export type ChatLiveStatus = {
  phase: AgentPhase['phase'] | 'working' | 'awaiting' | 'unresponsive' | 'reconnecting' | 'unreadable';
  waiting: AgentWaiting | null;
  elapsedMs: number | null;
  phaseMs: number | null;
  pulse: boolean;
  reason: string | null;
  asOf: number | null;
};

export function chatLiveStatus(verdict: RunVerdict | null, now: number): ChatLiveStatus | null {
  if (verdict === null) return null;
  return {
    phase: verdict.phase,
    waiting: verdict.waiting,
    elapsedMs: verdict.startedAt === null ? null : Math.max(0, now - verdict.startedAt),
    phaseMs: verdict.phaseSince === null ? null : Math.max(0, now - verdict.phaseSince),
    pulse: verdict.pulse,
    reason: verdict.reason,
    asOf: verdict.asOf,
  };
}

export type ChatLiveTail =
  | { readonly kind: 'status'; readonly status: ChatLiveStatus }
  | { readonly kind: 'step'; readonly entry: ActivityEntry; readonly clock: ChatLiveStatus | null };

export function chatLiveTail(status: ChatLiveStatus | null, newest: ActivityEntry | undefined): ChatLiveTail | null {
  if (status !== null && (newest === undefined || !status.pulse)) return { kind: 'status', status };
  return newest === undefined ? null : { kind: 'step', entry: newest, clock: status };
}

export type ChatLiveLine = ChatStepLine & { readonly lead: string };

export function chatLiveLine(status: ChatLiveStatus, strings: ChatStrings): ChatLiveLine {
  const phrase = strings.livePhase(status.phase, status.waiting);
  return { lead: status.reason === null ? phrase : `${phrase}:`, subject: status.reason, join: 'phrase' };
}

export function isLiveEntry(entry: ChatEntry, retry: ChatEntry | undefined): entry is ActivityEntry {
  switch (entry.kind) {
    case 'tool':
      return !toolSettled(entry);
    case 'reasoning':
      return entry.reasoningState === 'streaming';
    case 'compaction':
      return entry.compactionStatus === 'running';
    case 'retry':
      return entry === retry;
    default:
      return false;
  }
}
