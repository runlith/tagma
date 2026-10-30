import { HARNESS_CALL_OUTPUT_MAX, type HarnessCallReport } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { field } from '@runlith/tagma/adapter/payload';

const RESPONSE_KEYS = ['tool_response', 'tool_output', 'toolResult'] as const;

const textOf = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const failedResponse = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && ((value as Record<string, unknown>).is_error === true || 'error' in value);

export function hookCall(adapter: HarnessAdapter, event: Record<string, unknown>): HarnessCallReport | undefined {
  const id = field(event, 'tool_use_id') ?? field(event, 'toolUseId');
  const tool = field(event, 'tool_name') ?? field(event, 'toolName');
  if (id === null || tool === null) return undefined;
  const named = field(event, 'hook_event_name') ?? field(event, 'hookEventName');
  const mapped = adapter.subjectOf(event);
  const subject = mapped?.subject;
  const key = RESPONSE_KEYS.find((candidate) => candidate in event);
  const response = key === undefined ? undefined : event[key];
  const output = textOf(response)?.slice(0, HARNESS_CALL_OUTPUT_MAX);
  const events = adapter.hooks?.events;
  const done = named !== null && (named === events?.postWrite || named === events?.postRead || named === events?.toolFailure);
  const failed = (named !== null && named === events?.toolFailure) || (done && failedResponse(response));
  return {
    id,
    tool: mapped?.tool ?? tool,
    done: done ? true : undefined,
    subject: subject?.slice(0, 1000),
    output,
    failed: failed ? true : undefined,
  };
}
