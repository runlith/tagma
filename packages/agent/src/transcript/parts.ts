import type { AgentSignal, ThreadSignalAddressee } from '../agent/contracts';
import type { AgentEvent } from '../agent/AgentEvent';
import type { ThreadAttachmentRef } from './attachments';

export const THREAD_SIGNAL_PART = 'signal';
export const THREAD_RUNTIME_GUIDANCE_PART = 'runtime-guidance';
export const THREAD_TRANSCRIPT_PART = 'transcript-entry';
export const THREAD_QUESTION_PART = 'question';
export const THREAD_READY_ANSWERS_PART = 'ready-answers';

export const THREAD_TOOL_CONFIRM_KIND = 'thread.tool.confirm';
export const THREAD_TOOL_CONFIRM_VALUE = 'confirm';
export const THREAD_TOOL_CANCEL_VALUE = 'cancel';

export const USER_QUESTION_TOOL_NAME = 'ask_user';

export const FINAL_ANSWER_TOOL = 'send_message';

export type ThreadSignal = AgentSignal & {
  readonly addressee: ThreadSignalAddressee;
  readonly attachments?: readonly ThreadAttachmentRef[];
};

export const ATTACHED_CONTEXT_SIGNAL_TYPE = 'attached-context';
export const AGENT_MESSAGE_SIGNAL_TYPE = 'agent-message';

export type ThreadSignalPart = ThreadSignal & {
  readonly unread?: true;
};

export function threadSignalChunk(signal: ThreadSignal, options: { readonly unread?: true } = {}): AgentEvent {
  const shown: ThreadSignal =
    signal.attached === undefined ? signal : { ...signal, attached: signal.attached.filter((part) => part.type === 'media') };
  const data: ThreadSignalPart = options.unread ? { ...shown, unread: true } : shown;
  return { type: `data-${THREAD_SIGNAL_PART}`, id: signal.id, data } as AgentEvent;
}
