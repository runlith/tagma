# A minimal plugin end to end

A notes board per project: agents add notes with a tool, each call draws the board in the feed, and the project gets a Notes section that follows the board live. `create_plugin {id: "notes", title: "Notes"}`, install the folder's dependencies, write the files below, run `bunx tagma-plugin build` in the folder, then `install_plugin {source: ".tagma-plugins/notes"}`.

## `plugin.ts`

```ts
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { definePlugin, type PluginContext, Refusal, resource, tool } from '@runlith/tagma/plugin';
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
  views: [{ id: 'board', entry: 'ui/board.html' }],
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

## `ui/board.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; padding: 12px; font: var(--font-text-sm-size, 13px) var(--font-sans, sans-serif);
             color: var(--color-text-primary); background: var(--color-background-primary); }
      li { padding: 4px 0; border-bottom: 1px solid var(--color-border-secondary); }
      .muted { color: var(--color-text-secondary); }
    </style>
  </head>
  <body>
    <ul id="notes"></ul>
    <p id="note" class="muted"></p>
    <script type="module" src="./board.js"></script>
  </body>
</html>
```

## `ui/board.js`

```js
const PROTOCOL = '2026-01-26';
const waiting = new Map();
let next = 0;

const post = (message) => window.parent.postMessage(message, '*');
const request = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = `n${++next}`;
    waiting.set(id, { resolve, reject });
    post({ jsonrpc: '2.0', id, method, params });
  });

const applyContext = (context) => {
  if (context?.theme) document.documentElement.dataset.theme = context.theme;
  for (const [name, value] of Object.entries(context?.styles?.variables ?? {})) document.documentElement.style.setProperty(name, value);
};

let height = 0;
const fit = () => {
  const now = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (now === height) return;
  height = now;
  post({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height } });
};
new ResizeObserver(fit).observe(document.body);

const show = (notes) => {
  const list = document.getElementById('notes');
  list.replaceChildren(...notes.map((note) => Object.assign(document.createElement('li'), { textContent: note.text })));
  document.getElementById('note').textContent = notes.length === 0 ? 'No notes yet.' : '';
};

const refresh = async () => {
  const answer = await request('tools/call', { name: 'list_notes', arguments: {} });
  if (answer.isError) throw new Error(answer.content?.[0]?.text ?? 'list_notes failed');
  show(answer.structuredContent.notes);
};

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (data?.jsonrpc !== '2.0') return;
  if (data.method === undefined && data.id !== undefined) {
    const held = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error) held?.reject(new Error(data.error.message));
    else held?.resolve(data.result);
    return;
  }
  if (data.method === 'ui/resource-teardown') post({ jsonrpc: '2.0', id: data.id, result: {} });
  else if (data.method === 'ui/notifications/host-context-changed') applyContext(data.params);
  else if (data.method === 'notifications/resources/updated') void refresh();
});

const handshake = await request('ui/initialize', { protocolVersion: PROTOCOL, appInfo: { name: 'notes-board', version: '1' }, appCapabilities: {} });
applyContext(handshake.hostContext);
post({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
await request('resources/subscribe', { uri: `notes://project/${handshake.hostContext.tagma.projectId}` });
await refresh().catch((failure) => {
  document.getElementById('note').textContent = failure.message;
});
```

The same page serves the section and the feed entry of `add_note`: in the feed it could also read the call from `ui/notifications/tool-result`, and here it shows the whole board instead.
