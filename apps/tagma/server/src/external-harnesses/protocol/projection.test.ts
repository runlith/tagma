import { expect, test } from 'bun:test';
import type { ClientEvent } from '@runlith/acp/events';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { project } from './projection.js';

const AT = '2026-10-04T12:00:00.000Z';
const opened = [
  {
    id: 'turn-1',
    startedAt: '2026-10-04T11:59:00.000Z',
    parts: { text: 0, reasoning: 0 },
    assistant: [],
    said: '',
    words: 'go',
    recorded: true,
  },
];

test('a turn projects as its messages and its tool call by turn and id, and ends with the spend the agent gave', () => {
  const events: ClientEvent[] = [
    { _tag: 'Message', turn: 'turn-1', message: { stream: 'thought', messageId: null, content: [{ type: 'text', text: 'thinking' }] } },
    {
      _tag: 'ToolCallStarted',
      turn: 'turn-1',
      call: { toolCallId: 'call-1', title: 'Write a.txt', kind: 'edit', status: 'pending', rawInput: { file_path: 'a.txt' } },
    },
    {
      _tag: 'ToolCallEnded',
      turn: 'turn-1',
      call: { toolCallId: 'call-1', title: 'Write a.txt', kind: 'edit', status: 'completed' },
      update: { toolCallId: 'call-1', status: 'completed' },
    },
    { _tag: 'Message', turn: 'turn-1', message: { stream: 'message', messageId: 'm-2', content: [{ type: 'text', text: 'Done.' }] } },
    {
      _tag: 'TurnEnded',
      turn: 'turn-1',
      envelopes: ['e-1'],
      delivery: 'accepted',
      outcome: {
        _tag: 'Stopped',
        stopReason: 'end_turn',
        usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10, cachedReadTokens: 5 },
        meta: { 'tagma/turn': { prompt: 'p-1', last: 'l-1' }, 'tagma/cost': { amount: 0.25, currency: 'USD' } },
      },
    },
  ];

  const projected = project(events, opened, AT);

  expect(projected.boundaries.map((entry) => [entry.type, entry.id])).toEqual([
    ['reasoning', 'reasoning:turn-1'],
    ['tool', 'tool:turn-1:call-1'],
    ['tool', 'tool:turn-1:call-1'],
    ['message', 'assistant:turn-1'],
  ]);
  expect(projected.ended).toMatchObject([
    {
      turn: 'turn-1',
      at: AT,
      status: 'completed',
      failure: null,
      stoppedBy: null,
      rest: { inputTokens: 20, nonCachedInputTokens: 15, outputTokens: 10, totalTokens: 30, cacheReadInputTokens: 5 },
      cost: { amount: 0.25, currency: 'USD', basis: 'list' },
    },
  ]);
  expect(projected.turns).toEqual([]);
  expect(projected.closed).toEqual([{ ...opened[0]!, parts: { text: 1, reasoning: 1 }, said: 'Done.' }]);
  expect(projected.vendor).toEqual([{ run: 'turn-1', address: 'p-1' }]);
});

test('a hosted assistant message keeps reasoning, text and all tool calls together across durable boundaries, then flushes its last message', () => {
  const first = project(
    [
      { _tag: 'Message', turn: 'turn-1', message: { stream: 'thought', messageId: 'm:0', content: [{ type: 'text', text: 'thinking' }] } },
      {
        _tag: 'Message',
        turn: 'turn-1',
        message: { stream: 'message', messageId: 'm:1', content: [{ type: 'text', text: 'Checking both' }] },
      },
      { _tag: 'ToolCallStarted', turn: 'turn-1', call: { toolCallId: 'a', title: 'read', rawInput: {} } },
      {
        _tag: 'ToolCallChanged',
        turn: 'turn-1',
        call: { toolCallId: 'a', title: 'read', rawInput: { path: 'a' } },
        update: { toolCallId: 'a', rawInput: { path: 'a' } },
      },
      {
        _tag: 'ToolCallEnded',
        turn: 'turn-1',
        call: { toolCallId: 'a', title: 'read', rawInput: { truncated: true }, status: 'completed' },
        update: { toolCallId: 'a', status: 'completed' },
      },
      { _tag: 'ToolCallStarted', turn: 'turn-1', call: { toolCallId: 'b', title: 'read', rawInput: { path: 'b' } } },
    ],
    opened,
    AT,
    true,
  );
  expect(first.messages).toEqual([]);
  const closed = project([{ _tag: 'Sealed', said: { sessionId: 's', messageId: 'm', toolCallIds: ['a', 'b'] } }], first.turns, AT, true);
  expect(closed.messages).toMatchObject([
    {
      role: 'assistant',
      id: 'm',
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'Checking both' },
        { type: 'tool-call', id: 'a', name: 'read', input: { path: 'a' } },
        { type: 'tool-call', id: 'b', name: 'read', input: { path: 'b' } },
      ],
    },
    { role: 'tool', content: [{ type: 'tool-result', id: 'a', name: 'read' }] },
  ]);
  const final = project(
    [
      { _tag: 'Message', turn: 'turn-1', message: { stream: 'message', messageId: 'last', content: [{ type: 'text', text: 'Done' }] } },
      {
        _tag: 'TurnEnded',
        turn: 'turn-1',
        envelopes: [],
        delivery: 'accepted',
        outcome: { _tag: 'Stopped', stopReason: 'end_turn', usage: null, meta: null },
      },
    ],
    closed.turns,
    AT,
    true,
  );
  expect(final.messages).toMatchObject([{ role: 'assistant', content: [{ type: 'text', text: 'Done' }] }]);
  expect(final.messages).toHaveLength(1);
});

test('a late update to an ended call amends its journaled entry, and one with no entry in its turn writes nothing', () => {
  const ended = project(
    [
      {
        _tag: 'ToolCallStarted',
        turn: 'turn-1',
        call: { toolCallId: 'call-1', title: 'Read a.ts', status: 'in_progress', rawInput: { path: 'a.ts' } },
      },
      {
        _tag: 'ToolCallEnded',
        turn: 'turn-1',
        call: { toolCallId: 'call-1', title: 'Read a.ts', status: 'completed', rawInput: { path: 'a.ts' }, content: [] },
        update: { toolCallId: 'call-1', status: 'completed' },
      },
    ],
    opened,
    AT,
  );
  const standing = new Map(
    ended.boundaries.filter((entry): entry is ThreadToolEntry => entry.type === 'tool').map((entry) => [entry.id, entry]),
  );
  const amended = project(
    [
      { _tag: 'ToolCallAmended', turn: 'turn-1', update: { toolCallId: 'call-1', rawOutput: { lines: 3 } } },
      { _tag: 'ToolCallAmended', turn: 'turn-1', update: { toolCallId: 'call-0', rawOutput: { lines: 9 } } },
    ],
    opened,
    '2026-10-04T12:05:00.000Z',
    false,
    standing,
  );
  expect(amended.boundaries).toEqual([
    {
      type: 'tool',
      id: 'tool:turn-1:call-1',
      runId: 'turn-1',
      toolName: 'Read a.ts',
      toolCallId: 'call-1',
      toolState: 'output-available',
      toolInput: { path: 'a.ts' },
      toolOutput: { content: [], locations: [], rawOutput: { lines: 3 } },
      toolDisplay: { form: 'text', text: '{\n  "lines": 3\n}' },
      execution: { state: 'started', at: AT },
      occurredAt: AT,
    },
  ]);
  const failed = project(
    [
      { _tag: 'ToolCallStarted', turn: 'turn-1', call: { toolCallId: 'call-2', title: 'Run tests', status: 'in_progress' } },
      {
        _tag: 'ToolCallEnded',
        turn: 'turn-1',
        call: { toolCallId: 'call-2', title: 'Run tests', status: 'failed', rawOutput: { exit: 1 } },
        update: { toolCallId: 'call-2', status: 'failed' },
      },
      { _tag: 'ToolCallAmended', turn: 'turn-1', update: { toolCallId: 'call-2', title: 'Run the tests' } },
    ],
    opened,
    AT,
  );
  expect(failed.boundaries.at(-1)).toMatchObject({ toolName: 'Run the tests', toolState: 'output-error', toolError: '{"exit":1}' });
});

test('a late update to a call whose stored record cannot be read is told in the feed, and writes no call entry', () => {
  const unreadable: ThreadToolEntry = {
    type: 'tool',
    id: 'tool:turn-1:call-1',
    runId: 'turn-1',
    toolName: 'Read a.ts',
    toolCallId: 'call-1',
    toolState: 'output-available',
    toolOutput: 'plain words',
  };
  const projected = project(
    [{ _tag: 'ToolCallAmended', turn: 'turn-1', update: { toolCallId: 'call-1', status: 'failed' } }],
    opened,
    AT,
    false,
    new Map([[unreadable.id, unreadable]]),
  );
  expect(projected.boundaries).toMatchObject([{ type: 'interruption', runId: 'turn-1' }]);
});

test('a hosted call Tagma executes writes only its opening entry, while its input still reaches the assistant message', () => {
  const marked = { 'tagma/executes': true };
  const projected = project(
    [
      { _tag: 'ToolCallStarted', turn: 'turn-1', call: { toolCallId: 'own', title: 'read', rawInput: {}, _meta: marked } },
      {
        _tag: 'ToolCallChanged',
        turn: 'turn-1',
        call: { toolCallId: 'own', title: 'read', rawInput: { path: 'a' }, _meta: marked },
        update: { toolCallId: 'own', rawInput: { path: 'a' }, _meta: marked },
      },
      {
        _tag: 'ToolCallEnded',
        turn: 'turn-1',
        call: { toolCallId: 'own', title: 'read', status: 'completed', _meta: marked },
        update: { toolCallId: 'own', status: 'completed', _meta: marked },
      },
      { _tag: 'ToolCallAmended', turn: 'turn-1', update: { toolCallId: 'own', rawOutput: { lines: 3 }, _meta: marked } },
      { _tag: 'ToolCallStarted', turn: 'turn-1', call: { toolCallId: 'other', title: 'fetch', status: 'completed' } },
      { _tag: 'Sealed', said: { sessionId: 's', messageId: 'm', toolCallIds: ['own', 'other'] } },
    ],
    opened,
    AT,
    true,
  );
  expect(projected.boundaries).toMatchObject([
    { id: 'tool:turn-1:own', toolState: 'input-available' },
    { id: 'tool:turn-1:other', toolState: 'output-available' },
  ]);
  expect(projected.boundaries).toHaveLength(2);
  expect(projected.messages).toMatchObject([
    {
      content: [
        { type: 'tool-call', id: 'own', input: { path: 'a' } },
        { type: 'tool-call', id: 'other' },
      ],
    },
  ]);
});

test('a Tagma call Claude Code refused before handing it over ends at once with its words, and its result follows its message in the history', () => {
  const tagma = { 'tagma/executes': true };
  const kept = { 'tagma/executes': false };
  const refusal = 'No such tool available: mcp__tagma__read_output';
  const shown = { form: 'none', title: 'c-1', awaitsMs: 140_000 } as const;
  const projected = project(
    [
      {
        _tag: 'ToolCallStarted',
        turn: 'turn-1',
        call: { toolCallId: 'handed', title: 'read', name: 'read', status: 'pending', rawInput: { path: 'a' }, _meta: tagma },
      },
      {
        _tag: 'ToolCallStarted',
        turn: 'turn-1',
        call: {
          toolCallId: 'refused',
          title: 'read_output',
          name: 'read_output',
          status: 'pending',
          rawInput: { id: 'c-1' },
          _meta: tagma,
        },
      },
      { _tag: 'Sealed', said: { sessionId: 's', messageId: 'm', toolCallIds: ['handed', 'refused'] } },
      {
        _tag: 'ToolCallEnded',
        turn: 'turn-1',
        call: { toolCallId: 'handed', title: 'read', name: 'read', status: 'completed', _meta: tagma },
        update: { toolCallId: 'handed', status: 'completed', _meta: tagma },
      },
      {
        _tag: 'ToolCallEnded',
        turn: 'turn-1',
        call: {
          toolCallId: 'refused',
          title: 'read_output',
          name: 'read_output',
          status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text: refusal } }],
          _meta: kept,
        },
        update: { toolCallId: 'refused', status: 'failed', _meta: kept },
      },
    ],
    opened,
    AT,
    true,
    new Map(),
    null,
    (name) => (name === 'read_output' ? shown : undefined),
  );
  expect(projected.boundaries).toMatchObject([
    { id: 'tool:turn-1:handed', toolState: 'input-available', execution: { state: 'queued', gated: true } },
    { id: 'tool:turn-1:refused', toolState: 'input-available', toolDisplay: shown, execution: { state: 'queued', gated: true } },
    { id: 'tool:turn-1:refused', toolState: 'output-error', toolError: refusal },
  ]);
  expect(projected.boundaries).toHaveLength(3);
  expect(projected.boundaries[0]?.type === 'tool' ? projected.boundaries[0].toolDisplay : null).toBeUndefined();
  expect(projected.messages).toMatchObject([
    { role: 'assistant', content: [{ id: 'handed' }, { id: 'refused' }] },
    { role: 'tool', content: [{ type: 'tool-result', id: 'refused', result: { type: 'error', value: refusal } }] },
  ]);
  expect(projected.messages).toHaveLength(2);
});

test('a call of the agent is queued while pending, starts at its first in_progress and keeps that start to its end', () => {
  const later = '2026-10-04T12:00:09.000Z';
  const queued = project(
    [{ _tag: 'ToolCallStarted', turn: 'turn-1', call: { toolCallId: 'f', title: 'webfetch', status: 'pending', rawInput: {} } }],
    opened,
    AT,
  );
  const started = project(
    [
      {
        _tag: 'ToolCallChanged',
        turn: 'turn-1',
        call: { toolCallId: 'f', title: 'webfetch', status: 'in_progress', rawInput: {} },
        update: { toolCallId: 'f', status: 'in_progress' },
      },
    ],
    opened,
    AT,
  );
  const standing = new Map(started.boundaries.map((entry) => [entry.id, entry as ThreadToolEntry]));
  const ended = project(
    [
      {
        _tag: 'ToolCallEnded',
        turn: 'turn-1',
        call: { toolCallId: 'f', title: 'webfetch', status: 'completed', rawInput: {} },
        update: { toolCallId: 'f', status: 'completed' },
      },
    ],
    opened,
    later,
    false,
    standing,
  );
  expect(queued.boundaries).toMatchObject([{ toolState: 'input-available', execution: { state: 'queued' } }]);
  expect(queued.boundaries[0]).not.toHaveProperty('execution.gated');
  expect(started.boundaries).toMatchObject([{ toolState: 'input-available', execution: { state: 'started', at: AT } }]);
  expect(ended.boundaries).toMatchObject([{ toolState: 'output-available', execution: { state: 'started', at: AT } }]);
});

test('a cancelled turn ends aborted, and a failed one carries its failure as what the turn said', () => {
  const cancelled = project(
    [
      {
        _tag: 'TurnEnded',
        turn: 'turn-1',
        envelopes: [],
        delivery: 'accepted',
        outcome: { _tag: 'Stopped', stopReason: 'cancelled', usage: null, meta: null },
      },
    ],
    opened,
    AT,
  );
  expect(cancelled.ended).toMatchObject([{ status: 'aborted', failure: null }]);

  const died = project(
    [
      {
        _tag: 'TurnEnded',
        turn: 'turn-1',
        envelopes: [],
        delivery: 'unconfirmed',
        outcome: { _tag: 'Failed', cause: { _tag: 'Exited', detail: 'signal 9' } },
      },
    ],
    opened,
    AT,
  );
  expect(died.ended).toMatchObject([{ status: 'failed', failure: 'The agent process died: signal 9' }]);
  expect(died.closed[0]!.said).toBe('The agent process died: signal 9');
});

test('a failed summary retains the measured tokens and cost of its attempt', () => {
  const projected = project(
    [
      {
        _tag: 'TurnEnded',
        turn: 'turn-1',
        envelopes: [],
        delivery: 'accepted',
        outcome: {
          _tag: 'Failed',
          cause: { _tag: 'Agent', error: { code: -32000, message: 'No compact boundary' } },
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedReadTokens: 80 },
          meta: { 'tagma/cost': { amount: 0.04, currency: 'USD' } },
        },
      },
    ],
    opened,
    AT,
  );
  expect(projected.ended[0]).toMatchObject({
    status: 'failed',
    rest: { inputTokens: 100, nonCachedInputTokens: 20, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 80 },
    cost: { amount: 0.04, currency: 'USD', basis: 'list' },
  });
});
