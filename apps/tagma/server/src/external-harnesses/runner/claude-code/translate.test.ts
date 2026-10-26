import { expect, test } from 'bun:test';
import { Result } from 'effect';
import { EXECUTES } from '../../contract/wire/extensions.js';
import { Handed } from '../hosted/handed.js';
import { Names } from './names.js';
import { Translation } from './translate.js';

test('a call by a bare name the query aliases is a call Tagma executes, and one by a name it holds nowhere is not', () => {
  const names = new Names([]);
  names.hold(['read']);
  const [aliased, unknown] = Result.getOrThrow(
    new Translation(new Handed(), names).assistant({
      id: 'm5',
      model: 'claude-haiku-4-5',
      content: [
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'tool_use', id: 't1', name: 'read', input: { path: '/r/a.ts' } },
        { type: 'tool_use', id: 't2', name: 'ghost', input: {} },
      ],
    }),
  ).updates;
  expect(aliased).toMatchObject({ name: 'read', kind: 'read', status: 'pending', _meta: { [EXECUTES]: true } });
  expect(unknown).toMatchObject({ name: 'ghost', status: 'in_progress' });
  expect(unknown?._meta).toBeUndefined();
});

test('text that streamed is not said again when the whole assistant message arrives', () => {
  const translation = new Translation(new Handed(), new Names([]));
  const streamed = [
    ...translation.stream({ type: 'message_start', message: { id: 'm1' } }).updates,
    ...translation.stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'DO' } }).updates,
    ...translation.stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'NE' } }).updates,
  ];
  const whole = Result.getOrThrow(
    translation.assistant({ id: 'm1', model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'DONE' }] }),
  ).updates;
  expect(
    [...streamed, ...whole].map((update) =>
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? update.content.text : null,
    ),
  ).toEqual(['DO', 'NE']);
});

test('a call of a web tool of Claude Code is a fetch that Tagma did not execute', () => {
  const translation = new Translation(new Handed(), new Names([]));
  const [search, fetch] = Result.getOrThrow(
    translation.assistant({
      id: 'm4',
      model: 'claude-haiku-4-5',
      content: [
        { type: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'bun release' } },
        { type: 'tool_use', id: 't2', name: 'WebFetch', input: { url: 'https://bun.com', prompt: 'version' } },
      ],
    }),
  ).updates;
  expect(search).toMatchObject({ sessionUpdate: 'tool_call', title: 'websearch', name: 'websearch', kind: 'fetch', status: 'in_progress' });
  expect(fetch).toMatchObject({ sessionUpdate: 'tool_call', title: 'webfetch', name: 'webfetch', kind: 'fetch', status: 'pending' });
  for (const opened of [search, fetch]) expect(opened?._meta).toBeUndefined();
});

test('an edit through a Tagma tool is a tool call carrying its diff, and its result closes the call with the diff kept', () => {
  const translation = new Translation(new Handed(), new Names([]));
  const [opened] = Result.getOrThrow(
    translation.assistant({
      id: 'm2',
      model: 'claude-haiku-4-5',
      content: [{ type: 'tool_use', id: 't1', name: 'mcp__tagma__edit', input: { path: '/r/a.ts', oldString: 'a', newString: 'b' } }],
    }),
  ).updates;
  expect(opened).toMatchObject({
    sessionUpdate: 'tool_call',
    toolCallId: 't1',
    title: 'edit',
    kind: 'edit',
    status: 'pending',
    content: [{ type: 'diff', path: '/r/a.ts', oldText: 'a', newText: 'b' }],
    locations: [{ path: '/r/a.ts' }],
  });
  const [closed] = translation.user(
    { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'edited' }] }] },
    undefined,
  );
  expect(closed).toMatchObject({
    sessionUpdate: 'tool_call_update',
    toolCallId: 't1',
    status: 'completed',
    content: [
      { type: 'diff', path: '/r/a.ts' },
      { type: 'content', content: { type: 'text', text: 'edited' } },
    ],
  });
});
