import { threadMessageEntry, threadUserMessageEvent, type ThreadEventBody } from '@runlith/agent/thread/events';
import { assistantMessageEntryId, toolEntryId } from '@runlith/agent/transcript/entryNames';
import { settleTool, type ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { Message } from '@runlith/llm/schema/messages';
import type { Schema } from 'effect';
import type { HarnessCallReport } from '../../threads/contract/wire/harness/observation.js';

export const userWords = (runId: string, text: string, entryKey: string = runId): ThreadEventBody => {
  const event = threadUserMessageEvent({ id: entryKey }, { text, reader: false });
  return { ...event, payload: { ...event.payload, entry: { ...event.payload.entry, runId } } };
};

export const assistantWords = (runId: string, index: number, text: string, at: string): ThreadEventBody => ({
  kind: 'message',
  payload: {
    entry: threadMessageEntry(assistantMessageEntryId(runId, index), 'assistant', runId, text, at),
    messages: [Message.assistant(text)],
  },
});

const toolInput = (call: HarnessCallReport): Schema.Json => (call.subject === undefined ? {} : { subject: call.subject });

export const callOpened = (runId: string, call: HarnessCallReport, at: string): ThreadEventBody => {
  const entry: ThreadToolEntry = {
    type: 'tool',
    id: toolEntryId(call.id),
    runId,
    toolName: call.tool,
    toolCallId: call.id,
    toolState: 'input-available',
    toolInput: toolInput(call),
    execution: { state: 'started', at },
    occurredAt: at,
  };
  return { kind: 'tool', payload: { entry } };
};

export const callSettled = (runId: string, call: HarnessCallReport, at: string): ThreadEventBody => {
  const settled =
    call.failed === true
      ? settleTool({ kind: 'failed', error: call.output ?? 'the tool call failed' })
      : settleTool({ kind: 'answered', output: call.output });
  const entry: ThreadToolEntry = {
    type: 'tool',
    id: toolEntryId(call.id),
    runId,
    toolName: call.tool,
    toolCallId: call.id,
    toolInput: toolInput(call),
    ...settled,
    occurredAt: at,
  };
  return { kind: 'tool', payload: { entry } };
};
