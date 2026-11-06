import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpCallerMeta } from '@runlith/mcp/caller';

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
        structuredContent: { operation: 'read_statuses', code: 'thread-unknown', reason: 'No such thread.', unblock: ['list_threads'] },
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
  { declared: "  views: [{ id: 'board', entry: 'board.html' }],", step: 'check', reason: 'contributes.views: Expected a string matching' },
  {
    declared: "  options: [{ key: 'PATH', title: 'Path', description: 'Where.' }],",
    step: 'check',
    reason: 'PATH is a variable every process is started with',
  },
  {
    declared: "  views: [{ id: 'board', entry: 'ui/board.html' }], surfaces: [{ view: 'nowhere', title: 'Nowhere' }],",
    step: 'check',
    reason: 'contributes.surfaces: names the view nowhere, which contributes.views does not declare',
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
