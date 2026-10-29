import { expect } from 'bun:test';
import { resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { mcpToolCatalog } from '@runlith/mcp/mcpToolCatalog';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { ASKS_IN_REVIEW } from '../../../platform/contract/wire/conditions.js';
import { makeDoorWorld } from '../doorFixture.js';
import { committed, type Files, repository, skill, written } from './files.js';

const MCP_SERVER = resolve(import.meta.dir, '../../../../../../../packages/mcp/test/mcpTestServer.ts');

const CLAUDE_CODE: Files = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'cc-demo', version: '1.0.0', outputStyles: './styles/' }),
  'skills/greet/SKILL.md': skill('Greets.'),
  'commands/hello.md': '---\ndescription: Says hello.\n---\nSay hello to $ARGUMENTS.\n',
  'agents/helper.md': '---\nname: helper\ndescription: Helps.\ntools: Read, Bash, NotebookEdit\n---\nHelp.\n',
  '.mcp.json': JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [MCP_SERVER] } } }),
  'hooks/hooks.json': JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo blocked >&2; exit 2' }] }], Notification: [] },
  }),
  'styles/terse.md': 'Be terse.\n',
};

const AGENT_PLUGINS: Files = {
  'plugin.json': JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'ap.demo',
    flavour: 'mild',
  }),
  'skills/summarize/SKILL.md': skill('Summarizes.'),
  'mcp.json': JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      echo: { type: 'stdio', command: 'bun', args: [MCP_SERVER, '${PLUGIN_ROOT}'] },
      absolute: { type: 'stdio', command: process.execPath },
      remote: { type: 'streamable-http', url: 'http://127.0.0.1:9/mcp', headers: { 'X-Home': '${HOME}' } },
      legacy: { type: 'sse', url: 'https://mcp.example.com/sse' },
    },
  }),
};

const BOTH: Files = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'both-demo' }),
  'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'both-demo' }),
  'skills/plan/SKILL.md': skill('Plans.'),
  'agents/planner.md': '---\ndescription: Plans.\n---\nPlan.\n',
  '.mcp.json': JSON.stringify({ echo: { command: process.execPath, args: [MCP_SERVER] } }),
};

const MALFORMED: Files = {
  'plugin.json': JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'broken',
    author: { name: 7 },
  }),
};

const COLLIDING: Files = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'twice' }),
  'skills/x/SKILL.md': skill('A skill named x.'),
  'commands/x.md': 'A command named x.\n',
};

type McpRow = {
  readonly name: string;
  readonly scope: string;
  readonly status: string;
  readonly tools: number;
  readonly contributor?: string;
};

type Row = {
  readonly id: string;
  readonly format: string | null;
  readonly enabled: boolean;
  readonly source: { readonly kind: string };
  readonly components: readonly { readonly kind: string; readonly name: string; readonly detail?: string }[];
  readonly ignored: readonly { readonly component: string; readonly name: string | null }[];
};

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const projectId = yield* world.stealthProject();
  const scope = `project=${projectId}`;
  const installed: string[] = [];
  yield* Effect.addFinalizer(() =>
    Effect.forEach(installed, (id) => world.op('uninstall_plugin', { id }, scope), { discard: true }).pipe(Effect.orDie),
  );
  const install = Effect.fnUntraced(function* (source: string, more: { readonly scope?: string } = {}) {
    const answer = yield* world.op('install_plugin', { source, ...more }, scope);
    const body = answer.body as { readonly plugin?: Row; readonly code?: string; readonly reason?: string };
    if (body.plugin !== undefined) installed.push(body.plugin.id);
    return body;
  });
  return { world, scope, projectId, install };
});

class Plugins extends Context.Service<Plugins, Effect.Success<typeof setup>>()('testing/Plugins') {}

layer(Layer.effect(Plugins, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('plugins', (it) => {
  it.effect(
    'a plugin of each format installed from a folder reaches the agent as <plugin>-<name>, lists what Tagma ignores, and disabling withdraws it',
    () =>
      Effect.gen(function* () {
        const { world, scope, projectId, install } = yield* Plugins;
        const cc = (yield* install(yield* written(yield* world.directory('cc'), CLAUDE_CODE))).plugin;
        expect(cc?.format).toBe('claude-code');
        expect(cc?.components).toEqual(
          expect.arrayContaining([
            { kind: 'skill', name: 'cc-demo-greet' },
            { kind: 'command', name: 'cc-demo-hello' },
            { kind: 'agent', name: 'cc-demo-helper', detail: 'no Tagma tool for NotebookEdit' },
            expect.objectContaining({ kind: 'mcp-server', name: 'cc-demo-echo' }),
            { kind: 'hook', name: 'PreToolUse Read: echo blocked >&2; exit 2' },
          ]),
        );
        expect(cc?.ignored).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ component: 'outputStyles' }),
            expect.objectContaining({ component: 'hook', name: 'Notification' }),
          ]),
        );

        const ap = (yield* install(yield* written(yield* world.directory('ap'), AGENT_PLUGINS))).plugin;
        expect(ap?.format).toBe('agent-plugins');
        expect(ap?.id).toBe('ap-demo');
        expect(ap?.components.map((component) => component.name).sort()).toEqual(['ap-demo-echo', 'ap-demo-remote', 'ap-demo-summarize']);
        expect(ap?.ignored).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ component: 'plugin.json', name: 'flavour' }),
            expect.objectContaining({ component: 'mcp-server', name: 'legacy' }),
            expect.objectContaining({ component: 'mcp-server', name: 'absolute' }),
          ]),
        );

        const both = (yield* install(yield* written(yield* world.directory('both'), BOTH))).plugin;
        expect(both?.format).toBe('claude-code');
        expect(both?.components).toEqual(expect.arrayContaining([{ kind: 'agent', name: 'both-demo-planner' }]));

        const plain = yield* world.op('create_thread', {}, scope);
        const reader = (plain.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
        const skills = Effect.suspend(() =>
          Effect.map(world.op('read_agent_skills', { kind: 'thread', id: reader }, scope), (answer) =>
            (answer.body as { skills: readonly { id: string }[] }).skills.map((entry) => entry.id),
          ),
        );
        const agents = Effect.suspend(() =>
          Effect.map(world.op('read_agent_library', {}, scope), (answer) =>
            (answer.body as { definitions: readonly { id: string }[] }).definitions.map((entry) => entry.id),
          ),
        );
        const servers = Effect.suspend(() =>
          Effect.map(world.op('read_mcp_servers', {}, scope), (answer) =>
            (answer.body as { mcp: readonly McpRow[] }).mcp.filter((row) => row.scope === 'contributed'),
          ),
        );
        expect(yield* skills).toEqual(expect.arrayContaining(['cc-demo-greet', 'cc-demo-hello', 'ap-demo-summarize', 'both-demo-plan']));
        expect(yield* agents).toEqual(expect.arrayContaining(['cc-demo-helper', 'both-demo-planner']));
        const started = yield* world.op('create_thread', { type: 'cc-demo-helper' }, scope);
        expect(started.status).toBe(200);

        const mcp = Context.get(world.runtime.owners, McpServers);
        yield* mcp.reconcile(projectId);
        const offered = mcp.palette(projectId).find((entry) => entry.declaration.name === 'cc-demo-echo');
        expect(offered).toBeDefined();
        const tools = mcpToolCatalog({
          projectId,
          declaration: offered!.declaration,
          descriptors: offered!.descriptors,
          pool: mcp.caller(projectId),
        }).tools;
        expect(tools['echo']).toMatchObject({ approval: ASKS_IN_REVIEW, mutates: true });
        const connected = new Map((yield* servers).map((row) => [row.name, row]));
        for (const name of ['cc-demo-echo', 'ap-demo-echo', 'both-demo-echo']) {
          expect(connected.get(name)).toMatchObject({
            status: 'connected',
            contributor: name.slice(0, name.lastIndexOf('-')),
            capabilities: { kinds: ['read', 'write', 'execute', 'network'], mutates: true },
          });
          expect(connected.get(name)?.tools).toBeGreaterThan(0);
        }

        for (const id of ['cc-demo', 'ap-demo', 'both-demo']) yield* world.op('enable_plugin', { id, enabled: false }, scope);
        expect((yield* skills).filter((id) => id.includes('-demo-'))).toEqual([]);
        expect((yield* agents).filter((id) => id.includes('-demo-'))).toEqual([]);
        expect((yield* servers).filter((row) => row.name.includes('-demo-'))).toEqual([]);
      }),
  );

  it.effect('a plugin is installed from a git URL into the data directory, and installing the URL again updates it', () =>
    Effect.gen(function* () {
      const { world, install } = yield* Plugins;
      const root = yield* world.directory('repository');
      yield* repository(root, { ...CLAUDE_CODE, '.claude-plugin/plugin.json': JSON.stringify({ name: 'cloned' }) });
      const first = (yield* install(`file://${root}`)).plugin;
      expect(first?.source.kind).toBe('git');
      expect((first as unknown as { root: string }).root.startsWith(world.dataHome)).toBe(true);

      yield* committed(root, { 'skills/wave/SKILL.md': skill('Waves.') });
      const again = (yield* install(`file://${root}`)).plugin;
      expect(again?.components).toEqual(expect.arrayContaining([{ kind: 'skill', name: 'cloned-wave' }]));
    }),
  );

  it.effect('a malformed Agent Plugins manifest and colliding component names are refused with their reasons', () =>
    Effect.gen(function* () {
      const { world, install } = yield* Plugins;
      const malformed = yield* install(yield* written(yield* world.directory('malformed'), MALFORMED));
      expect(malformed).toMatchObject({ code: 'plugin-refused' });
      expect(malformed.reason).toContain('author');

      const colliding = yield* install(yield* written(yield* world.directory('colliding'), COLLIDING));
      expect(colliding).toMatchObject({ code: 'plugin-names-collide' });
      expect(colliding.reason).toContain('twice-x');
    }),
  );

  it.effect(
    'a plugin enabled for every project runs in each, a project switches it off alone, and dropping every project keeps the projects that enabled it',
    () =>
      Effect.gen(function* () {
        const { world, scope, install } = yield* Plugins;
        const other = `project=${yield* world.stealthProject()}`;
        const root = yield* written(yield* world.directory('everywhere'), {
          '.claude-plugin/plugin.json': JSON.stringify({ name: 'everywhere' }),
          'skills/wave/SKILL.md': skill('Waves.'),
        });
        const state = Effect.fnUntraced(function* (at: string) {
          const rows = ((yield* world.op('read_plugins', {}, at)).body as { plugins: readonly (Row & { everywhere: boolean })[] }).plugins;
          const row = rows.find((entry) => entry.id === 'everywhere');
          const offered = ((yield* world.op('read_agent_skills', { kind: 'draft' }, at)).body as { skills: readonly { id: string }[] })
            .skills;
          return { enabled: row?.enabled, everywhere: row?.everywhere, offered: offered.some((entry) => entry.id === 'everywhere-wave') };
        });
        const on = { enabled: true, everywhere: true, offered: true };
        const off = { enabled: false, everywhere: true, offered: false };

        expect((yield* install(root, { scope: 'user' })).plugin).toMatchObject({ enabled: true, everywhere: true });
        expect([yield* state(scope), yield* state(other)]).toEqual([on, on]);

        yield* world.op('enable_plugin', { id: 'everywhere', enabled: false }, other);
        expect([yield* state(scope), yield* state(other)]).toEqual([on, off]);

        yield* world.op('enable_plugin', { id: 'everywhere' }, other);
        yield* world.op('enable_plugin', { id: 'everywhere', scope: 'user', enabled: false }, scope);
        expect([yield* state(scope), yield* state(other)]).toEqual([
          { enabled: false, everywhere: false, offered: false },
          { enabled: true, everywhere: false, offered: true },
        ]);
      }),
  );

  it.effect('disabling a plugin in the project keeps it installed and stops it here', () =>
    Effect.gen(function* () {
      const { world, scope, install } = yield* Plugins;
      const plugin = (yield* install(
        yield* written(yield* world.directory('switch'), { ...BOTH, '.claude-plugin/plugin.json': JSON.stringify({ name: 'switched' }) }),
      )).plugin;
      expect(plugin?.enabled).toBe(true);
      const off = yield* world.op('enable_plugin', { id: 'switched', enabled: false }, scope);
      expect(off.body).toMatchObject({ plugin: { id: 'switched', enabled: false } });
      const read = yield* world.op('read_plugins', {}, scope);
      expect((read.body as { plugins: readonly Row[] }).plugins).toContainEqual(
        expect.objectContaining({ id: 'switched', enabled: false }),
      );
    }),
  );
});
