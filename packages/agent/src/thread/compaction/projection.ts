import type { CompactionSummary } from '@runlith/llm/schema/compaction';
import { Message } from '@runlith/llm/schema/messages';
import { foldedReferences } from '../../agent/AgentDeferredTools';
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
  const covered = Math.min(checkpoint.coveredMessageCount, messages.length);
  const head = [
    withAgentOrigin(
      Message.make({ role: 'user', content: checkpointMarker, metadata: foldedReferences(messages.slice(0, covered)) }),
      'summary',
    ),
    withAgentOrigin(Message.make({ role: 'assistant', content: checkpoint.summary, compaction: checkpoint.context }), 'summary'),
  ];
  for (let index = covered - 1; index >= 0; index -= 1) {
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
