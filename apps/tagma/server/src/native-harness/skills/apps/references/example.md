# A minimal app end to end

A notes board per project: agents add notes with a tool, each call draws the board in the feed, and the project gets a Notes section that follows the board live. Write it into `.tagma-apps/notes/`, run `bun add @modelcontextprotocol/sdk` there, then `install_app` with id `notes`.

## `tagma-app.json`

```json
{
  "id": "notes",
  "title": "Notes",
  "process": { "command": "bun", "args": ["server/main.ts"] },
  "contributes": {
    "tools": [
      { "name": "add_note", "audience": "agents" },
      { "name": "list_notes", "audience": "view" }
    ],
    "views": [{ "id": "board", "entry": "ui/board.html" }],
    "results": [{ "tool": "add_note", "view": "board" }],
    "surfaces": [{ "view": "board", "title": "Notes" }]
  }
}
```

## `server/main.ts`

```ts
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

type Caller = { readonly kind: 'agent' | 'operator' | 'tagma'; readonly projectId: number | null };
type Note = { readonly id: number; readonly text: string; readonly at: number };

class Refusal extends Error {}

const data = process.env.TAGMA_APP_DATA;
if (data === undefined) {
  console.error('notes: TAGMA_APP_DATA is set by Tagma and was not');
  process.exit(1);
}

const fileOf = (project: number) => join(data, `notes-${project}.json`);
const uriOf = (project: number) => `notes://project/${project}`;
const URI = /^notes:\/\/project\/(\d+)$/u;

function read(project: number): Note[] {
  try {
    return JSON.parse(readFileSync(fileOf(project), 'utf8')) as Note[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function write(project: number, notes: readonly Note[]): void {
  const staged = `${fileOf(project)}.${process.pid}`;
  writeFileSync(staged, JSON.stringify(notes));
  renameSync(staged, fileOf(project));
}

function projectOf(meta: Readonly<Record<string, unknown>> | undefined): number {
  const caller = meta?.['runlith/caller'] as Caller | undefined;
  if (caller === undefined || caller.projectId === null) throw new Refusal('notes belong to a project; call from inside one');
  return caller.projectId;
}

function ownResource(uri: string, meta: Readonly<Record<string, unknown>> | undefined): number {
  const matched = URI.exec(uri);
  if (matched === null) throw new Refusal(`no resource ${uri}`);
  const project = projectOf(meta);
  if (project !== Number(matched[1])) throw new Refusal('a view reads only the board of its own project');
  return project;
}

const subscribed = new Set<string>();

const TOOLS = [
  {
    name: 'add_note',
    description: 'Add a note to the board of this project.',
    inputSchema: { type: 'object' as const, properties: { text: { type: 'string', description: 'The note.' } }, required: ['text'] },
  },
  {
    name: 'list_notes',
    description: 'The notes of the board, for its view.',
    inputSchema: { type: 'object' as const, properties: {} },
    annotations: { readOnlyHint: true },
  },
];

const mcp = new Server({ name: 'notes', version: '1.0.0' }, { capabilities: { tools: {}, resources: { subscribe: true } } });

mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

mcp.setRequestHandler(CallToolRequestSchema, ({ params }) => {
  try {
    const project = projectOf(params._meta);
    const notes = read(project);
    if (params.name === 'list_notes') {
      return { content: [{ type: 'text' as const, text: `${notes.length} notes` }], structuredContent: { notes } };
    }
    if (params.name !== 'add_note') throw new Refusal(`no tool ${params.name}`);
    const text = typeof params.arguments?.text === 'string' ? params.arguments.text.trim() : '';
    if (text === '') throw new Refusal('a note needs text');
    const note: Note = { id: (notes.at(-1)?.id ?? 0) + 1, text, at: Date.now() };
    write(project, [...notes, note]);
    const uri = uriOf(project);
    if (subscribed.has(uri)) {
      void mcp.notification({ method: 'notifications/resources/updated', params: { uri } }).catch((failure) => console.error(failure));
    }
    return { content: [{ type: 'text' as const, text: `Added note ${note.id}.` }], structuredContent: { note } };
  } catch (error) {
    if (!(error instanceof Refusal)) console.error(`[notes] ${params.name}`, error);
    return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

mcp.setRequestHandler(ReadResourceRequestSchema, ({ params }) => {
  const notes = read(ownResource(params.uri, params._meta));
  return { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify({ notes }) }] };
});

mcp.setRequestHandler(SubscribeRequestSchema, ({ params }) => {
  ownResource(params.uri, params._meta);
  subscribed.add(params.uri);
  return {};
});

mcp.setRequestHandler(UnsubscribeRequestSchema, ({ params }) => {
  subscribed.delete(params.uri);
  return {};
});

mcp.onclose = () => process.exit(0);
process.stdin.on('end', () => process.exit(0));
await mcp.connect(new StdioServerTransport());
console.error(`[notes] up, data in ${data}`);
```

`subscribed` keeps one set for the whole machine: the host holds one protocol subscription per URI and admits each further caller — another project or view — through its own `resources/subscribe`, which `ownResource` judges.

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
