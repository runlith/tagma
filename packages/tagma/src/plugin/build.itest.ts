import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpCallerMeta } from '@runlith/mcp/caller';
import { graphFiles, svelteFiles } from './bundling.js';
import { viewCompileOptions, viewModuleOptions } from './checks.generated.js';

const sdk = resolve(import.meta.dir, '../..');
const cli = join(import.meta.dir, 'cli.ts');

const run = async (argv: readonly string[], cwd: string) => {
  const child = Bun.spawn([...argv], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out: `${stdout}${stderr}` };
};

const folder = async (id: string): Promise<{ readonly root: string; readonly plugin: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'tagma-plugin-'));
  const plugin = join(root, id);
  expect(await run([process.execPath, cli, 'init', plugin, '--title', 'Greeter'], root)).toMatchObject({ code: 0 });
  await mkdir(join(plugin, 'node_modules/@runlith'), { recursive: true });
  await mkdir(join(plugin, 'node_modules/@types'), { recursive: true });
  await symlink(sdk, join(plugin, 'node_modules/@runlith/tagma'));
  await symlink(join(sdk, 'node_modules/zod'), join(plugin, 'node_modules/zod'));
  await symlink(join(sdk, 'node_modules/@types/bun'), join(plugin, 'node_modules/@types/bun'));
  return { root, plugin };
};

const ASKING = [
  "import { definePlugin, TagmaRefused, tool } from '@runlith/tagma/plugin';",
  "import { z } from 'zod';",
  '',
  "console.log('a banner printed while the plugin loads');",
  "process.stdout.write('a write without a newline');",
  '',
  'const asked = tool({',
  "  description: 'Ask Tagma the status of a thread.',",
  "  audience: 'agents',",
  '  input: z.object({ thread: z.string() }),',
  '  run: async ({ thread }, ctx) => {',
  '    try {',
  "      return await ctx.tagma.op('read_statuses', { threads: [thread] });",
  '    } catch (error) {',
  '      if (!(error instanceof TagmaRefused)) throw error;',
  '      return { operation: error.operation, code: error.code, reason: error.reason, unblock: error.unblock };',
  '    }',
  '  },',
  '});',
  '',
].join('\n');

type Asked = { readonly path: string; readonly caller: string | null; readonly thread: string };

const tagmaStandIn = () => {
  const asked: Asked[] = [];
  const held = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const { threads } = (await request.json()) as { readonly threads: readonly string[] };
      const thread = threads[0] ?? '';
      asked.push({ path: `${url.pathname}${url.search}`, caller: request.headers.get('x-tagma-caller'), thread });
      if (thread === 'refused')
        return Response.json({ code: 'thread-unknown', reason: 'No such thread.', unblock: ['list_threads'] }, { status: 409 });
      if (thread === 'broken') return Response.json({ message: 'the server fell over' }, { status: 500 });
      request.signal.addEventListener('abort', () => cancelled.resolve());
      held.resolve();
      return new Promise<Response>(() => undefined);
    },
  });
  return { server, asked, held: held.promise, cancelled: cancelled.promise };
};

test('a template folder builds through tagma-plugin into a manifest whose process serves exactly its tools over stdio MCP', async () => {
  const { root, plugin } = await folder('greeter');
  const tagma = tagmaStandIn();
  try {
    const definition = (await readFile(join(plugin, 'plugin.ts'), 'utf8'))
      .replace("import { definePlugin, tool } from '@runlith/tagma/plugin';\nimport { z } from 'zod';\n", ASKING)
      .replace('  tools: {', '  tools: {\n    asked,');
    await writeFile(join(plugin, 'plugin.ts'), definition);
    const built = await run([process.execPath, cli, 'build', plugin], root);
    expect(built).toMatchObject({ code: 0 });
    const manifest = JSON.parse(await readFile(join(plugin, 'tagma-plugin.json'), 'utf8'));
    expect(manifest).toMatchObject({ id: 'greeter', title: 'Greeter', version: '0.1.0', process: { entry: 'dist/process.js' } });
    expect(manifest.build.sources).toEqual(['package.json', 'plugin.ts']);
    const hash = new Bun.CryptoHasher('sha256');
    for (const path of manifest.build.sources) {
      const bytes = await readFile(join(plugin, path));
      hash.update(`${path}\0${bytes.byteLength}\0`);
      hash.update(bytes);
    }
    expect(manifest.build.hash).toBe(hash.digest('hex'));
    expect(manifest.contributes.tools).toMatchObject([
      { name: 'asked', audience: 'agents', inputSchema: { type: 'object', required: ['thread'] } },
      { name: 'hello', audience: 'agents', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', required: ['name'] } },
    ]);
    expect((await run([process.execPath, 'test'], plugin)).code).toBe(0);

    const client = new Client({ name: 'host', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--no-install', '--no-env-file', join(plugin, 'dist/process.js')],
        cwd: plugin,
        env: {
          TAGMA_CALLER: 'plugin:greeter',
          TAGMA_PLUGIN_DATA: join(root, 'data'),
          TAGMA_SERVER_URL: `http://127.0.0.1:${tagma.server.port}`,
          PATH: process.env.PATH ?? '',
        },
        stderr: 'pipe',
      }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }))).toEqual(
        manifest.contributes.tools.map(({ name, description, inputSchema, annotations }: Record<string, unknown>) => ({
          name,
          description,
          inputSchema,
          annotations,
        })),
      );
      const _meta = mcpCallerMeta({ kind: 'agent', projectId: 3, agentId: 'a', ownerId: 'o', thread: null });
      const invalid = await client.callTool({ name: 'hello', arguments: { name: 7 }, _meta });
      expect(invalid).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('name') }] });
      expect(await client.callTool({ name: 'hello', arguments: { name: 'Ada' }, _meta })).toMatchObject({
        content: [{ type: 'text', text: 'Hello, Ada!' }],
      });

      expect(await client.callTool({ name: 'asked', arguments: { thread: 'refused' }, _meta })).toMatchObject({
        structuredContent: {
          value: { operation: 'read_statuses', code: 'thread-unknown', reason: 'No such thread.', unblock: ['list_threads'] },
        },
      });
      expect(await client.callTool({ name: 'asked', arguments: { thread: 'broken' }, _meta })).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('read_statuses failed with HTTP 500') }],
      });
      const cancel = new AbortController();
      const waiting = client.callTool({ name: 'asked', arguments: { thread: 'held' }, _meta }, undefined, { signal: cancel.signal });
      await tagma.held;
      cancel.abort();
      await expect(waiting).rejects.toThrow();
      await tagma.cancelled;
      expect(tagma.asked).toEqual(
        ['refused', 'broken', 'held'].map((thread) => ({ path: '/api/op/read_statuses?project=3', caller: 'plugin:greeter', thread })),
      );
    } finally {
      await client.close();
    }
  } finally {
    await tagma.server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

const REFUSED = [
  { declared: "  views: { board: { entry: 'ui/board.html' } },", step: 'check', reason: 'contributes.views: ' },
  {
    declared: "  options: [{ key: 'PATH', title: 'Path', description: 'Where.' }],",
    step: 'check',
    reason: 'PATH is a variable every process is started with',
  },
  {
    declared: "  views: { board: { entry: 'ui/board.svelte' } }, surfaces: [{ view: 'nowhere', title: 'Nowhere' }],",
    step: 'check',
    reason: 'contributes.surfaces: names the view nowhere, which contributes.views does not declare',
  },
  {
    declared: "  themes: { swapped: { title: 'Swapped', dark: { signals: { failure: '#a3be8c' } } } },",
    step: 'check',
    reason:
      "contributes.themes: the theme swapped, dark: signals.failure #a3be8c reads as done: its hue 131° is outside failure's 322°–31°",
  },
  {
    declared: `  themes: { round: { title: 'Round', dark: { signals: { failure: 'oklch(0.7 0.19 ${'9'.repeat(309)})' } } } },`,
    step: 'check',
    reason: 'contributes.themes: write a colour as #rrggbb, or oklch(L C H) with L and C from 0 to 1 and H in degrees under 1000',
  },
  {
    declared:
      "  tools: {\n    loads: tool({ description: 'Load a module.', audience: 'agents', input: z.object({ name: z.string() }), run: async ({ name }) => String(require(name)) }),",
    step: 'bundle',
    reason: 'names a module by a computed value',
  },
] as const;

test('a plugin the server would refuse or its process could not load stops the build with the reason: a schema, its filter, a sibling point, a computed import', async () => {
  const { root, plugin } = await folder('viewer');
  try {
    const template = await readFile(join(plugin, 'plugin.ts'), 'utf8');
    for (const { declared, step, reason } of REFUSED) {
      const replaced = declared.includes('tools: {') ? declared : `${declared}\n  tools: {`;
      await writeFile(join(plugin, 'plugin.ts'), template.replace('  tools: {', replaced));
      const built = await run([process.execPath, cli, 'build', plugin], root);
      expect(built.code).toBe(1);
      expect(built.out).toContain(`The build stopped at ${step}`);
      expect(built.out).toContain(reason);
      expect(await Bun.file(join(plugin, 'tagma-plugin.json')).exists()).toBe(false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const BOARD = [
  '<script lang="ts">',
  "  import { Button, useTagma } from '@runlith/tagma/ui';",
  "  import Star from 'glyphs/icons/star.svelte';",
  "  import { counter } from './counter.svelte';",
  '  const tagma = useTagma();',
  '</script>',
  '<div class="grid-cols-7 p-2"><Star /><Button onclick={() => counter.up()}>{counter.n}</Button></div>',
  '<style>div { color: red; }</style>',
  '',
].join('\n');

const SIDE = [
  '<script lang="ts">',
  "  import { Frame } from '@runlith/tagma/ui';",
  "  import logo from './logo.png';",
  "  import { counter } from './counter.svelte';",
  '</script>',
  '<img src={logo} alt="" /><Frame src="https://meet.example" title="Meet" media />{counter.n}',
  '',
].join('\n');

const COUNTER = [
  'class Counter {',
  '  n = $state(0);',
  '  up(): void {',
  '    this.n += 1;',
  '  }',
  '}',
  'export const counter: Counter = new Counter();',
  '',
].join('\n');

const VIEWS_DEFINITION = [
  "import { definePlugin, view } from '@runlith/tagma/plugin';",
  '',
  'export default definePlugin({',
  "  id: 'board',",
  "  title: 'Board',",
  "  views: { board: view('./ui/Board.svelte'), side: view('./ui/Side.svelte', { live: true }) },",
  "  surfaces: [{ view: 'board', title: 'Board', icon: 'ui/icon.svg' }],",
  '});',
  '',
].join('\n');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const viewsFolder = async () => {
  const { root, plugin } = await folder('board');
  await mkdir(join(plugin, 'node_modules/glyphs/icons'), { recursive: true });
  await writeFile(join(plugin, 'node_modules/glyphs/package.json'), JSON.stringify({ name: 'glyphs', version: '1.2.3' }));
  await writeFile(join(plugin, 'node_modules/glyphs/icons/star.svelte'), '<svg viewBox="0 0 1 1"><path d="M0 0" /></svg>\n');
  await mkdir(join(plugin, 'ui'), { recursive: true });
  const files: Readonly<Record<string, string | Buffer>> = {
    'plugin.ts': VIEWS_DEFINITION,
    'ui/Board.svelte': BOARD,
    'ui/Side.svelte': SIDE,
    'ui/counter.svelte.ts': COUNTER,
    'ui/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" />\n',
    'ui/logo.png': PNG,
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(plugin, path), content);
  return { root, plugin };
};

test('a plugin of Svelte views ships its view graph: own files in place, a dependency by name and version, the candidates, and a graph that bundles with no node_modules', async () => {
  const { root, plugin } = await viewsFolder();
  try {
    expect(await run([process.execPath, cli, 'build', plugin], root)).toMatchObject({ code: 0 });
    const ui = join(plugin, 'dist/ui');
    const graph = JSON.parse(await readFile(join(ui, 'graph.json'), 'utf8'));
    expect(graph.files['ui/Board.svelte'].imports).toMatchObject({
      '@runlith/tagma/ui': 'host',
      'svelte/internal/client': 'host',
      './counter.svelte': 'ui/counter.svelte.ts',
      'glyphs/icons/star.svelte': '_modules/glyphs@1.2.3/icons/star.svelte',
    });
    expect(graph.files['ui/Side.svelte'].imports).toMatchObject({
      './logo.png': 'ui/logo.png',
      './counter.svelte': 'ui/counter.svelte.ts',
    });
    expect(Object.keys(graph.files)).toEqual([...Object.keys(graph.files)].sort());
    expect(graph.files['ui/icon.svg']).toEqual({ imports: {} });
    expect(graph.files['_modules/glyphs@1.2.3/icons/star.svelte'].dependency).toBe(true);
    expect(graph.files['ui/Board.svelte'].dependency).toBeUndefined();
    expect(await readFile(join(ui, 'ui/counter.svelte.ts'), 'utf8')).toBe(COUNTER);
    expect(await Bun.file(join(ui, '_modules/glyphs@1.2.3/icons/star.svelte')).exists()).toBe(true);
    expect(graph.candidates).toEqual([...new Set<string>(graph.candidates)].sort());
    expect(graph.candidates).toEqual(expect.arrayContaining(['grid-cols-7', 'p-2']));

    const manifest = JSON.parse(await readFile(join(plugin, 'tagma-plugin.json'), 'utf8'));
    expect(manifest.contributes.views).toEqual([
      { id: 'board', entry: 'ui/Board.svelte' },
      { id: 'side', entry: 'ui/Side.svelte', live: true, media: true },
    ]);
    expect(manifest.process).toBeUndefined();
    expect(manifest.build.sources).toEqual(
      expect.arrayContaining([
        'package.json',
        'plugin.ts',
        'ui/Board.svelte',
        'ui/Side.svelte',
        'ui/counter.svelte.ts',
        'ui/icon.svg',
        'ui/logo.png',
      ]),
    );
    expect(manifest.build.sources.some((path: string) => path.includes('glyphs'))).toBe(false);

    await writeFile(join(ui, 'stale.txt'), 'left by an earlier build');
    expect(await run([process.execPath, cli, 'build', plugin], root)).toMatchObject({ code: 0 });
    expect(await Bun.file(join(ui, 'stale.txt')).exists()).toBe(false);

    const alone = await mkdtemp(join(tmpdir(), 'tagma-graph-'));
    try {
      await cp(ui, alone, { recursive: true });
      const compiler = await import('svelte/compiler');
      const bundle = await Bun.build({
        entrypoints: [join(alone, 'ui/Board.svelte'), join(alone, 'ui/Side.svelte')],
        plugins: [
          graphFiles({ root: alone, graph, hosts: new Set(['@runlith/tagma/ui']) }),
          svelteFiles({
            compiler,
            graphPath: (absolute) => relative(alone, absolute),
            component: (path) => viewCompileOptions(path, graph.files[path]?.dependency === true),
            module: viewModuleOptions,
            failed: () => undefined,
          }),
        ],
        target: 'browser',
        splitting: true,
        throw: false,
      });
      expect(bundle.logs.map(String)).toEqual([]);
      expect(bundle.success).toBe(true);
      const code = (await Promise.all(bundle.outputs.map((output) => output.text()))).join('\n');
      expect(code).toContain('grid-cols-7');
      expect(code).toContain('M0 0');
    } finally {
      await rm(alone, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const VIEW_REFUSED = [
  {
    file: 'ui/compiled.js',
    text: "import { push } from 'svelte/internal/client';\nexport const compiled = push;\n",
    import: "  import './compiled';",
    reason: "ui/compiled.js imports svelte/internal/client, which only Svelte's compiler writes",
  },
  {
    file: 'ui/addon.node',
    text: 'not an addon',
    import: "  import './addon.node';",
    reason: 'is a native addon, which a view cannot carry',
  },
  {
    file: 'ui/lazy.ts',
    text: 'export const lazy = (name: string) => import(name);\n',
    import: "  import { lazy } from './lazy';\n  lazy;",
    reason: 'the views name a module by a computed value in 1 import or require call',
  },
  {
    file: 'ui/style.css',
    text: 'div { color: red; }\n',
    import: "  import './style.css';",
    reason: "ui/Board.svelte imports ./style.css: a view styles itself with Tailwind classes and its components' <style>",
  },
  {
    file: 'ui/compile.ts',
    text: "export { compile } from 'svelte/compiler';\n",
    import: "  import { compile } from './compile';\n  compile;",
    reason: 'ui/compile.ts imports svelte/compiler, which the window does not serve to a view',
  },
  {
    file: 'ui/Broken.svelte',
    text: '<div>{</div>\n',
    import: "  import Broken from './Broken.svelte';\n  Broken;",
    reason: 'ui/Broken.svelte: ',
  },
] as const;

test('a view the window could not load stops the build with the reason, naming the file: a compile error, a stylesheet, a native addon, a computed import, a compiler import', async () => {
  const { root, plugin } = await viewsFolder();
  try {
    for (const refused of VIEW_REFUSED) {
      await writeFile(join(plugin, refused.file), refused.text);
      await writeFile(join(plugin, 'ui/Board.svelte'), BOARD.replace('  const tagma', `${refused.import}\n  const tagma`));
      const built = await run([process.execPath, cli, 'build', plugin], root);
      expect(built.code).toBe(1);
      expect(built.out).toContain('The build stopped at views');
      expect(built.out).toContain(refused.reason);
      expect(await Bun.file(join(plugin, 'tagma-plugin.json')).exists()).toBe(false);
      await rm(join(plugin, refused.file));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const TYPED_DEFINITION = [
  "import { definePlugin, tool, view } from '@runlith/tagma/plugin';",
  "import { z } from 'zod';",
  '',
  'export default definePlugin({',
  "  id: 'board',",
  "  title: 'Board',",
  '  tools: {',
  "    peek: tool({ description: 'Peek.', audience: 'view', input: z.object({ id: z.string() }), run: async ({ id }) => ({ seen: id }) }),",
  "    hello: tool({ description: 'Hello.', audience: 'agents', run: async () => 'hello' }),",
  '  },',
  "  views: { board: view('./ui/Board.svelte') },",
  "  surfaces: [{ view: 'board', title: 'Board' }],",
  '});',
  '',
].join('\n');

const FRAME = '<Frame src="https://meet.example" title="Meet" height={200} fill media />';

const TYPED_BOARD = (body: string): string =>
  [
    '<script lang="ts">',
    "  import { Button, Frame, useTagma } from '@runlith/tagma/ui';",
    "  import type plugin from '../plugin';",
    '  const tagma = useTagma<typeof plugin>();',
    body,
    '</script>',
    '<Button variant="outline" onclick={() => void tagma.tools.peek({ id: "a" })}>peek</Button>',
    FRAME,
    '',
  ].join('\n');

const SDK_ONLY_PLUGIN = JSON.stringify({
  name: '@runlith/tagma',
  type: 'module',
  exports: {
    './plugin': { types: './src/plugin/plugin.ts', default: './src/plugin/plugin.ts' },
    './testing': { types: './src/plugin/testing.ts', default: './src/plugin/testing.ts' },
  },
});

const typedFolder = async () => {
  const { root, plugin } = await folder('board');
  const stub = join(plugin, 'node_modules/@runlith/tagma');
  await rm(stub);
  await mkdir(stub, { recursive: true });
  await writeFile(join(stub, 'package.json'), SDK_ONLY_PLUGIN);
  await symlink(join(sdk, 'src'), join(stub, 'src'));
  await mkdir(join(plugin, 'ui'), { recursive: true });
  await writeFile(join(plugin, 'plugin.ts'), TYPED_DEFINITION);
  return { root, plugin };
};

const MISUSES = [
  { body: '  void tagma.storage.get(tagma.projectId.toFixed());', reason: null },
  { body: '  void tagma.tools.hello();', reason: "Property 'hello' does not exist" },
  { body: '  void tagma.speech.status();', reason: null },
  { body: '  void tagma.speech.nope();', reason: "Property 'nope' does not exist" },
] as const;

test('a Svelte view is type-checked against the SDK’s own @runlith/tagma/ui and svelte, whatever its folder holds: typed tools, component props, and the file and place of a misuse', async () => {
  const { root, plugin } = await typedFolder();
  try {
    expect(await Bun.file(join(plugin, 'node_modules/svelte')).exists()).toBe(false);
    for (const { body, reason } of MISUSES) {
      await writeFile(join(plugin, 'ui/Board.svelte'), TYPED_BOARD(body));
      const built = await run([process.execPath, cli, 'build', plugin], root);
      if (reason === null) {
        expect(built).toMatchObject({ code: 0 });
        continue;
      }
      expect(built.code).toBe(1);
      expect(built.out).toContain('The build stopped at types');
      expect(built.out).toMatch(/ui\/Board\.svelte\(\d+,\d+\): error TS\d+/u);
      expect(built.out).toContain(reason);
    }
    const props = ['<Button variant="nope">x</Button>', '<Frame src="https://meet.example" title="Meet" sandbox="" />'];
    for (const markup of props) {
      await writeFile(join(plugin, 'ui/Board.svelte'), TYPED_BOARD('').replace(FRAME, markup));
      const built = await run([process.execPath, cli, 'build', plugin], root);
      expect(built.code).toBe(1);
      expect(built.out).toMatch(/ui\/Board\.svelte\(\d+,\d+\): error TS\d+/u);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
