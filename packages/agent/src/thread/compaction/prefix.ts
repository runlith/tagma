import type { Message } from '@runlith/llm/schema/messages';
import { type AgentMessageOrigin, agentOriginOf, opensTurnMessage } from '../../agent/AgentSignal';
import { estimateThreadTokens, estimateThreadTokenSuffixes } from './measurement';
import type { ThreadCompactionPolicy } from './policy';

export function selectThreadCompactionPrefix(
  messages: readonly Message[],
  alreadyCovered: number,
  usableTokens: number,
  policy: ThreadCompactionPolicy,
): number | null {
  if (alreadyCovered >= messages.length) return null;
  const turns = messages.flatMap((message, index) =>
    index >= alreadyCovered && opensTurnMessage(message) ? [{ start: index, end: messages.length }] : [],
  );
  for (let index = 0; index < turns.length - 1; index += 1) {
    const turn = turns[index];
    const next = turns[index + 1];
    if (turn && next) turns[index] = { ...turn, end: next.start };
  }
  if (turns.length === 0) return messages.length;
  const recentBudget = Math.min(policy.maxRecentTokens, Math.max(policy.minRecentTokens, Math.floor(usableTokens * policy.recentFraction)));
  const recent = turns.slice(-policy.recentUserTurns);
  let retainedFrom: number | null = null;
  let retainedTokens = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    if (!turn) continue;
    const suffix = estimateThreadTokenSuffixes(messages.slice(turn.start, turn.end));
    const turnTokens = suffix[0]!;
    if (retainedTokens + turnTokens <= recentBudget) {
      retainedFrom = turn.start;
      retainedTokens += turnTokens;
      continue;
    }
    const remaining = recentBudget - retainedTokens;
    if (remaining > 0 && turn.end - turn.start > 1) {
      for (let candidate = turn.start + 1; candidate < turn.end; candidate += 1) {
        if (!isThreadCompactionBoundary(messages, candidate)) continue;
        if (suffix[candidate - turn.start]! > remaining) continue;
        retainedFrom = candidate;
        break;
      }
    }
    break;
  }
  if (retainedFrom === null) return messages.length;
  return retainedFrom > alreadyCovered ? retainedFrom : null;
}

export function previousThreadCompactionBoundary(messages: readonly Message[], alreadyCovered: number, before: number): number | null {
  for (let candidate = Math.min(before - 1, messages.length - 1); candidate > alreadyCovered; candidate -= 1) {
    if (isThreadCompactionBoundary(messages, candidate)) return candidate;
  }
  return null;
}

export type ThreadOpeningPin = Pick<ThreadCompactionPolicy, 'maxOpeningTokens' | 'imageTokens'>;

export function pinnedOpening(messages: readonly Message[], coveredMessageCount: number, pin: ThreadOpeningPin): Message | null {
  if (coveredMessageCount <= 0 || coveredMessageCount >= messages.length) return null;
  const cut = messages[coveredMessageCount];
  if (cut !== undefined && opensTurnMessage(cut)) return null;
  for (let index = coveredMessageCount - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== 'user') continue;
    const origin = agentOriginOf(message);
    if (origin === 'envelope') return null;
    if (origin !== undefined) continue;
    const foldsMore = messages
      .slice(0, coveredMessageCount)
      .some((covered, at) => at !== index && !HEAD_OR_RUNTIME.has(agentOriginOf(covered)));
    return foldsMore && estimateThreadTokens(message, pin.imageTokens) <= pin.maxOpeningTokens ? message : null;
  }
  return null;
}

const HEAD_OR_RUNTIME: ReadonlySet<AgentMessageOrigin | undefined> = new Set(['summary', 'orientation', 'guidance']);

function isThreadCompactionBoundary(messages: readonly Message[], index: number): boolean {
  return index > 0 && index <= messages.length && messages[index]?.role !== 'tool';
}
