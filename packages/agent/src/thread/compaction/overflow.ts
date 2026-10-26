import { Message } from '@runlith/llm/schema/messages';
import { withAgentOrigin } from '../../agent/AgentSignal';
import { latestTurnStart, omitThreadMedia } from './media';
import type { ThreadCompactionText } from './text';

type OverflowText = Pick<ThreadCompactionText, 'overflowMediaGuidance' | 'omittedMedia'>;

export function omitEarlierMedia(
  messages: readonly Message[],
  text: Pick<ThreadCompactionText, 'omittedMedia'>,
): { messages: readonly Message[]; omittedMedia: number } {
  const turn = latestTurnStart(messages);
  const answered = messages.findLastIndex((message) => message.role === 'assistant');
  const omitted = omitThreadMedia(messages, (picture) => picture.index < (picture.tool ? answered : turn), text.omittedMedia);
  return { messages: omitted.messages, omittedMedia: omitted.omitted };
}

export function projectThreadOverflowRecovery(
  messages: readonly Message[],
  text: OverflowText,
): {
  messages: readonly Message[];
  omittedMedia: number;
} {
  const omitted = omitEarlierMedia(messages, text);
  if (omitted.omittedMedia === 0) return omitted;
  return {
    messages: [...omitted.messages, withAgentOrigin(Message.user(text.overflowMediaGuidance), 'guidance')],
    omittedMedia: omitted.omittedMedia,
  };
}
