import { agentToolOutputText } from '../../agent/ToolOutput';
import { agentRetold } from '../../agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';

export const THREAD_COMPACTION_TOOL_OUTPUT_MAX_CHARS = 2_000;

export function serializeThreadMessage(message: Message): string {
  if (!agentRetold(message)) return '';
  const speaker = message.role === 'user' ? 'User' : message.role === 'system' ? 'System' : 'Assistant';
  return message.content
    .flatMap((part) => {
      if (part.type === 'text') return [`[${speaker}]: ${part.text}`];
      if (part.type === 'reasoning') return part.text ? [`[Assistant reasoning]: ${part.text}`] : [];
      if (part.type === 'tool-call') return [`[Assistant tool call]: ${part.name}(${jsonText(part.input)})`];
      if (part.type === 'tool-result') {
        return [`[Tool result ${part.name}]: ${truncateToolOutput(agentToolOutputText(part.result))}`];
      }
      if (part.type === 'model-fallback') return [`[Assistant model fallback]: ${part.from.model} -> ${part.to.model}`];
      return [`[Attached ${part.mediaType}]`];
    })
    .join('\n');
}

function truncateToolOutput(value: string): string {
  return value.length <= THREAD_COMPACTION_TOOL_OUTPUT_MAX_CHARS
    ? value
    : `${value.slice(0, THREAD_COMPACTION_TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
