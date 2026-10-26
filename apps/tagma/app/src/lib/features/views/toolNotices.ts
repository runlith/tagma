import { toolCancelled, toolInterrupted, toolSettled, type ToolActivityEntry } from '@runlith/chat-ui/activity';
import type { ViewParams } from './ViewBridge.js';

export type ToolNotice = { readonly method: string; readonly params: ViewParams };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function toolInputNotice(entry: ToolActivityEntry): ToolNotice {
  return { method: 'ui/notifications/tool-input', params: { arguments: isRecord(entry.toolInput) ? entry.toolInput : {} } };
}

export function toolOutcomeNotice(entry: ToolActivityEntry): ToolNotice | null {
  if (!toolSettled(entry)) return null;
  if (toolCancelled(entry) || toolInterrupted(entry)) {
    return { method: 'ui/notifications/tool-cancelled', params: { reason: entry.toolError ?? entry.toolState } };
  }
  const shown = entry.display?.app?.result;
  if (shown !== undefined) return { method: 'ui/notifications/tool-result', params: shown };
  const output = entry.toolOutput;
  const failed = entry.toolState !== 'output-available';
  const text =
    typeof output === 'string'
      ? output
      : isRecord(output) && typeof output.text === 'string'
        ? output.text
        : (entry.toolError ?? entry.toolRefusal?.reason ?? '');
  const structured = isRecord(output) && isRecord(output.structuredContent) ? { structuredContent: output.structuredContent } : {};
  return {
    method: 'ui/notifications/tool-result',
    params: { content: [{ type: 'text', text }], ...structured, isError: failed ? true : undefined },
  };
}
