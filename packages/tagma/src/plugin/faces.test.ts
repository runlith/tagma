import { expect, test } from 'bun:test';
import { z } from 'zod';
import { definePlugin, type ToolFace, tool, type ViewTools } from './plugin.js';

const plugin = definePlugin({
  id: 'board',
  title: 'Board',
  tools: {
    list: tool({
      description: 'List the cards of a column.',
      audience: 'view',
      input: z.object({ column: z.string() }),
      run: async ({ column }) => ({ count: column.length }),
    }),
    ping: tool({ description: 'Answer a ping.', audience: 'view', run: async () => 'pong' }),
    sweep: tool({ description: 'Sweep the board.', audience: 'agents', run: async () => 1 }),
  },
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Views = ViewTools<typeof plugin>;

type Face = ToolFace<typeof plugin, 'list'>;

test('a view tool keeps its audience, its input and its output type, so a view calls it and a card reads its result typed', () => {
  const proof: readonly [
    Equal<keyof Views, 'list' | 'ping'>,
    Equal<Views['list'], (input: { column: string }) => Promise<{ count: number }>>,
    Equal<Views['ping'], (input?: Readonly<Record<never, never>>) => Promise<string>>,
    Equal<Face['input'], { column: string }>,
    Equal<Face['output'], { count: number } | undefined>,
    Equal<Face['state'], 'running' | 'done' | 'refused' | 'failed'>,
  ] = [true, true, true, true, true, true];
  expect(proof).toHaveLength(6);
});
