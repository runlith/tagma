import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpCallerMeta } from '@runlith/mcp/caller';
import { pluginTemplate } from './template.js';

const sdk = resolve(import.meta.dir, '../..');
const cli = join(import.meta.dir, 'cli.ts');

const folder = async (id: string): Promise<{ readonly root: string; readonly plugin: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'tagma-plugin-'));
  const plugin = join(root, id);
  await mkdir(join(plugin, 'node_modules/@runlith'), { recursive: true });
  await mkdir(join(plugin, 'node_modules/@types'), { recursive: true });
  for (const file of pluginTemplate({ id, title: 'Greeter' })) await writeFile(join(plugin, file.path), file.text);
  await symlink(sdk, join(plugin, 'node_modules/@runlith/tagma'));
  await symlink(join(sdk, 'node_modules/zod'), join(plugin, 'node_modules/zod'));
  await symlink(join(sdk, 'node_modules/@types/bun'), join(plugin, 'node_modules/@types/bun'));
  return { root, plugin };
};

const run = async (argv: readonly string[], cwd: string) => {
  const child = Bun.spawn([...argv], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out: `${stdout}${stderr}` };
};

test('a template folder builds through tagma-plugin into a manifest whose process serves exactly its tools over stdio MCP', async () => {
  const { root, plugin } = await folder('greeter');
  try {
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
      { name: 'hello', audience: 'agents', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', required: ['name'] } },
    ]);
    expect((await run([process.execPath, 'test'], plugin)).code).toBe(0);

    const client = new Client({ name: 'host', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--no-install', '--no-env-file', join(plugin, 'dist/process.js')],
        cwd: plugin,
        env: { TAGMA_CALLER: 'plugin:greeter', TAGMA_PLUGIN_DATA: join(root, 'data'), PATH: process.env.PATH ?? '' },
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
    } finally {
      await client.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a manifest the point schemas refuse stops the build with the point and the schema’s reason', async () => {
  const { root, plugin } = await folder('viewer');
  try {
    const definition = (await readFile(join(plugin, 'plugin.ts'), 'utf8')).replace(
      '  tools: {',
      "  views: [{ id: 'board', entry: 'board.html' }],\n  tools: {",
    );
    await writeFile(join(plugin, 'plugin.ts'), definition);
    const built = await run([process.execPath, cli, 'build', plugin], root);
    expect(built.code).toBe(1);
    expect(built.out).toContain('The build stopped at check');
    expect(built.out).toContain('contributes.views: Expected a string matching');
    expect(await Bun.file(join(plugin, 'tagma-plugin.json')).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
