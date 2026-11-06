# A minimal plugin end to end

A notes board per project: agents add notes with a tool, each call draws the board in the feed, and the project gets a Notes section that follows the board live. `create_plugin {id: "notes", title: "Notes"}`, install the folder's dependencies, write the files below, run `bunx tagma-plugin build` in the folder, then `install_plugin {source: ".tagma-plugins/notes"}`.

## `plugin.ts`

```ts
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { definePlugin, type PluginContext, Refusal, resource, tool, view } from '@runlith/tagma/plugin';
import { z } from 'zod';

type Note = { readonly id: number; readonly text: string; readonly at: number };

const uriOf = (project: number) => `notes://project/${project}`;

const projectOf = (ctx: PluginContext): number => {
  if (ctx.project === null) throw new Refusal('notes belong to a project; call from inside one');
  return ctx.project;
};

const read = async (ctx: PluginContext): Promise<Note[]> => {
  const text = await readFile(join(ctx.data, 'notes.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '[]';
    throw error;
  });
  return JSON.parse(text) as Note[];
};

const write = async (ctx: PluginContext, notes: readonly Note[]): Promise<void> => {
  const staged = join(ctx.data, `notes.json.${process.pid}`);
  await writeFile(staged, JSON.stringify(notes));
  await rename(staged, join(ctx.data, 'notes.json'));
};

export default definePlugin({
  id: 'notes',
  title: 'Notes',
  tools: {
    add_note: tool({
      description: 'Add a note to the board of this project.',
      audience: 'agents',
      input: z.object({ text: z.string().trim().min(1).describe('The note') }),
      run: async ({ text }, ctx) => {
        const project = projectOf(ctx);
        const notes = await read(ctx);
        const note: Note = { id: (notes.at(-1)?.id ?? 0) + 1, text, at: Date.now() };
        await write(ctx, [...notes, note]);
        ctx.changed(uriOf(project));
        return { note };
      },
    }),
    list_notes: tool({
      description: 'The notes of the board, for its view.',
      audience: 'view',
      readOnly: true,
      run: async (_input, ctx) => {
        projectOf(ctx);
        return { notes: await read(ctx) };
      },
    }),
  },
  resources: {
    board: resource({
      uri: 'notes://project/{project}',
      read: async ({ project }, ctx) => {
        if (Number(project) !== projectOf(ctx)) throw new Refusal('a view reads only the board of its own project');
        return { notes: await read(ctx) };
      },
    }),
  },
  views: { board: view('./ui/Board.svelte') },
  results: [{ tool: 'add_note', view: 'board' }],
  surfaces: [{ view: 'board', title: 'Notes' }],
});
```

`ctx.data` is already the caller's project's directory, so two projects never share a board; `read` refuses a view of another project, and the same refusal keeps it from subscribing.

## `plugin.test.ts`

```ts
import { expect, test } from 'bun:test';
import { testPlugin } from '@runlith/tagma/testing';
import plugin from './plugin';

test('a note an agent adds reaches the board of its project only', async () => {
  const notes = testPlugin(plugin);
  expect((await notes.call('add_note', { text: 'ship it' })).isError).toBe(false);
  expect(notes.changed).toEqual(['notes://project/1']);
  expect(JSON.parse((await notes.read('notes://project/1')).text).notes).toHaveLength(1);
  expect((await notes.read('notes://project/2')).isError).toBe(true);
});
```

## `ui/Board.svelte`

```svelte
<script lang="ts">
  import { Button, useTagma } from '@runlith/tagma/ui';
  import type plugin from '../plugin';

  type Note = { readonly id: number; readonly text: string };

  const tagma = useTagma<typeof plugin>();
  const board = tagma.resource(`notes://project/${tagma.projectId}`);
  const notes = $derived((board.current as { readonly notes?: readonly Note[] } | undefined)?.notes ?? []);
</script>

<ul class="divide-y divide-border">
  {#each notes as note (note.id)}
    <li class="py-1 text-small">{note.text}</li>
  {:else}
    <li class="py-1 text-small text-muted-foreground">No notes yet.</li>
  {/each}
</ul>
{#if board.failure !== null}
  <p class="text-small text-chat-failure">{board.failure}</p>
{/if}
<Button size="sm" variant="ghost" onclick={() => void tagma.tools.list_notes()}>Refresh</Button>
```

The same component draws the section and the feed entry of `add_note`. In the feed it also receives the call as props, `{name, input, output, state, threadId}`; here it shows the whole board instead, followed live through the resource.
