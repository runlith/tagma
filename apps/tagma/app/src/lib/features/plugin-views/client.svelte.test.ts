import { toolResultOf } from '@runlith/tagma/plugin/value';
import { expect, test } from 'vitest';
import type { Door } from '$lib/wire/Door.js';
import { makeClient } from './client.svelte.js';

const answering = (value: unknown): Door => {
  const { text, structuredContent } = toolResultOf(value);
  return { perform: async () => ({ status: 'ok', result: { content: [{ type: 'text', text }], structuredContent } }) } as unknown as Door;
};

const absent = undefined as never;

const facts = { projectId: 1, plugin: 'board', view: 'board', threadId: null, key: null };

test('a view receives the value its tool returned, a string that looks like JSON staying a string', async () => {
  for (const value of ['123', 'false', 'null', '[{"id":1}]', '', 7, false, null, [{ id: 1 }], { id: 1 }, undefined]) {
    const client = makeClient(
      answering(value),
      absent,
      absent,
      absent,
      absent,
      absent,
      absent,
      absent,
      [],
      facts,
      new AbortController().signal,
    );
    expect(await client.tools.read!()).toEqual(value);
  }
});

test("a view calls a server its plugin brought as its own mount, and receives that server's result", async () => {
  const result = { content: [{ type: 'text', text: 'listed' }] };
  const asked: unknown[] = [];
  const door = {
    perform: async (...call: unknown[]) => {
      asked.push(call.slice(0, 3));
      return { status: 'ok', result };
    },
  } as unknown as Door;
  const client = makeClient(door, absent, absent, absent, absent, absent, absent, absent, [], facts, new AbortController().signal);
  expect(await client.servers.files!.call('list', { path: '.' })).toEqual(result);
  expect(asked).toEqual([
    [
      'call_contributed_tool',
      { plugin: 'board', view: 'board', server: 'files', tool: 'list', arguments: { path: '.' }, threadId: undefined },
      { project: '1' },
    ],
  ]);
});
