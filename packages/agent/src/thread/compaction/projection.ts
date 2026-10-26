import type { CompactionSummary } from '@runlith/llm/schema/compaction';
import { Message } from '@runlith/llm/schema/messages';
import { agentInputSkills, withAgentInputSkills, withAgentOrigin } from '../../agent/AgentSignal';
import { pinnedOpening, type ThreadOpeningPin } from './prefix';

type ThreadCheckpointProjection = {
  readonly coveredMessageCount: number;
  readonly summary: string;
  readonly context?: CompactionSummary;
};

export function threadCheckpointHead(
  checkpoint: ThreadCheckpointProjection,
  checkpointMarker: string,
  messages: readonly Message[],
  pin: ThreadOpeningPin,
): readonly Message[] {
  const head = [
    withAgentOrigin(Message.user(checkpointMarker), 'summary'),
    withAgentOrigin(Message.make({ role: 'assistant', content: checkpoint.summary, compaction: checkpoint.context }), 'summary'),
  ];
  for (let index = Math.min(checkpoint.coveredMessageCount, messages.length) - 1; index >= 0; index -= 1) {
    const skills = agentInputSkills(messages[index]!);
    if (skills === null) continue;
    if (skills.size > 0) head[0] = withAgentInputSkills(head[0]!, skills);
    break;
  }
  const inventory = lastInventory(messages, checkpoint.coveredMessageCount);
  if (inventory !== undefined) head[0] = Message.make({ ...head[0]!, content: [...head[0]!.content, inventory] });
  const pinned = checkpoint.context === undefined ? pinnedOpening(messages, checkpoint.coveredMessageCount, pin) : null;
  if (pinned !== null) head.push(pinned);
  return head;
}

function lastInventory(messages: readonly Message[], covered: number) {
  for (let index = Math.min(covered, messages.length) - 1; index >= 0; index -= 1) {
    const found = messages[index]!.content.findLast((part) => part.type === 'text' && part.deferredTools !== undefined);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function projectThreadHistory(
  messages: readonly Message[],
  checkpoint: ThreadCheckpointProjection | null,
  checkpointMarker: string,
  pin: ThreadOpeningPin,
): readonly Message[] {
  if (!checkpoint) return messages;
  const head = threadCheckpointHead(checkpoint, checkpointMarker, messages, pin);
  return [...head, ...messages.slice(checkpoint.coveredMessageCount)];
}
