import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { threadOpenChangeSchema } from '@runlith/agent/protocol/http';
import { movedDisplay } from './voice.js';

test('a transport move settles into a tool entry its reader decodes, naming the transport', () => {
  for (const answer of [
    { status: 'switched', threadId: 'harness-1', transport: 'terminal' },
    { status: 'unchanged', threadId: 'harness-1', transport: 'acp' },
  ] as const) {
    const display = movedDisplay(answer);
    const entry = {
      type: 'tool',
      id: 'tool:move-call',
      toolName: 'set_thread_transport',
      toolCallId: 'move-call',
      toolState: 'output-available',
      toolDisplay: display,
    };
    const change = Schema.decodeUnknownSync(threadOpenChangeSchema)(JSON.parse(JSON.stringify({ op: 'put', entry })));
    expect(change).toEqual({ op: 'put', entry });
    expect(display.facts?.map((fact) => fact.value)).toEqual([answer.transport]);
  }
});
