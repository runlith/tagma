import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, Layer, Schema } from 'effect';
import { mcpCallTool, mcpListTools, type McpSdkCallResult, type McpSdkConnection } from '@runlith/mcp/testing/sdk';
import { ToolDisplayMeta, toolDisplayOpensByDefault } from '@runlith/agent/tool/display';
import { MCP_KEY_VARIABLE } from '../../../platform/contract/wire/session.js';
import { SpawnRefused } from '../../../platform/testing/spawn.js';
import { makeMcpWorld } from './mcpRig.js';

const setup = Effect.gen(function* () {
  const rig = yield* makeMcpWorld();
  let onChange: (() => void) | undefined;
  const changed = () => {
    const notice = Promise.withResolvers<void>();
    onChange = notice.resolve;
    return Effect.promise(() => notice.promise);
  };
  const direct = yield* rig.bridge(
    'codex',
    {
      CODEX_THREAD_ID: 'itest-codex-session',
      CLAUDE_CODE_SESSION_ID: 'itest-not-this-one',
    },
    () => onChange?.(),
  );
  const gemini = yield* rig.bridge('gemini', { [MCP_KEY_VARIABLE]: 'itest-gemini-minted' });
  return { ...rig, direct, gemini, changed };
});
class Bridges extends Context.Service<Bridges, Effect.Success<typeof setup>>()('testing/Bridges') {}
const called = (connection: McpSdkConnection, tool: string, input: Record<string, unknown>) =>
  Effect.flatMap(Bridges, ({ call }) => mcpCallTool(connection, tool, input, call));
const rootOf = Effect.fnUntraced(function* () {
  const { world, project } = yield* Bridges;
  const roots = yield* world.tagma(['op', 'list_root_blocks', '--json', '--project', project.name], { cwd: project.root });
  return (JSON.parse(roots.out) as { blocks: { name: string }[] }).blocks[0]!.name;
});
const contentSchema = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
});
const textOf = (result: McpSdkCallResult) =>
  Effect.map(Schema.decodeUnknownEffect(contentSchema)(result), (value) =>
    value.content.flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n'),
  );
const documentOf = (result: McpSdkCallResult) =>
  Effect.flatMap(textOf(result), (text) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(text),
  );
const displayOf = Schema.decodeUnknownEffect(Schema.Struct({ _meta: ToolDisplayMeta }));
const failed = (result: McpSdkCallResult): boolean => 'content' in result && result.isError === true;

layer(Layer.effect(Bridges, setup), { excludeTestServices: true })('MCP CLI', (it) => {
  it.effect('a deferring CLI is offered the callable operation catalog', () =>
    Effect.gen(function* () {
      const { direct, call } = yield* Bridges;
      const page = yield* mcpListTools(direct, call);
      const names = page.tools.map((tool) => tool.name);
      expect(names).toContain('create_block');
      expect(names).toContain('read_block');
      expect(names).toEqual(
        expect.arrayContaining([
          'send_message',
          'send_task',
          'interrupt_agent',
          'spawn_agent',
          'list_agents',
          'stop_agent',
          'continue_agent',
        ]),
      );
      expect(names).toContain('continue_thread');
      expect(names).not.toContain('call_operation');
      const create = page.tools.find((tool) => tool.name === 'create_block');
      expect(create?.inputSchema.type).toBe('object');
      expect(create?.annotations?.readOnlyHint).toBe(false);
      expect(create?.annotations?.destructiveHint).toBe(false);
      expect(page.tools.find((tool) => tool.name === 'read_block')?.annotations?.readOnlyHint).toBe(true);
      expect(page.tools.find((tool) => tool.name === 'delete_block')?.annotations?.destructiveHint).toBe(true);
    }),
  );

  it.effect(
    'navigation defaults off, refuses calls without an engine, and MCP changes its offered tools when either setting layer changes',
    () =>
      Effect.gen(function* () {
        const { direct, gemini, call, world, project, changed } = yield* Bridges;
        const op = (id: string, input: unknown) =>
          world.tagma(['op', id, '--json', '--project', project.name, JSON.stringify(input)], { cwd: project.root });
        const set = (scope: 'user' | 'project', value?: boolean) => op('write_setting_layer', { scope, key: 'navigation.enabled', value });
        yield* Effect.addFinalizer(() => Effect.andThen(set('user'), set('project')));
        const outside = yield* world.directory('outside');
        const machine = yield* world.tagma(['op', 'read_capability_settings', '--json', '{}'], { cwd: outside });
        expect(JSON.parse(machine.out).disabled).toContain('navigation');
        expect((yield* mcpListTools(direct, call)).tools.map((tool) => tool.name)).not.toContain('uses');
        for (const name of ['definition', 'uses']) {
          const refusal = yield* documentOf(yield* called(direct, name, { name: 'Owner.member', json: true }));
          expect(refusal).toMatchObject({ status: 'refused', code: 'navigation-disabled', unblock: expect.any(Array) });
        }
        expect(JSON.parse((yield* op('read_navigation', { limit: 10 })).out)).toMatchObject({ engines: [], total: 0 });
        const listed = yield* documentOf(yield* called(gemini, 'list_operations', { match: 'uses', json: true }));
        expect(listed.operations).toEqual([]);
        const enabled = changed();
        expect((yield* set('user', true)).code).toBe(0);
        yield* enabled;
        expect((yield* mcpListTools(direct, call)).tools.map((tool) => tool.name)).toContain('uses');
        const disabled = changed();
        expect((yield* set('project', false)).code).toBe(0);
        yield* disabled;
        expect((yield* mcpListTools(direct, call)).tools.map((tool) => tool.name)).not.toContain('uses');
      }),
  );

  it.effect('a call through the bridge answers text, its document when it asks with json, and the display of its feed row', () =>
    Effect.gen(function* () {
      const { direct } = yield* Bridges;
      const parentId = yield* rootOf();
      const told = yield* called(direct, 'create_block', { title: 'Written over MCP', body: 'Its first body.', parentId });
      expect(yield* textOf(told)).toContain('Written over MCP');
      const shown = (yield* displayOf(told))._meta.toolDisplay;
      expect(shown.title).toEndWith('Written over MCP');
      expect(toolDisplayOpensByDefault(shown)).toBe(true);
      const answer = yield* documentOf(yield* called(direct, 'create_block', { title: 'Written as a document', parentId, json: true }));
      expect(answer.status).toBe('ok');
      expect((answer.block as { title?: string } | undefined)?.title).toBe('Written as a document');
      expect(answer._meta).toBeUndefined();
    }),
  );

  it.effect('a gate refusing arrives as the call’s failed result, its lines in text and its body with json', () =>
    Effect.gen(function* () {
      const { direct } = yield* Bridges;
      const told = yield* called(direct, 'create_block', { title: 'Nowhere', parentId: 'ffffffff' });
      expect(failed(told)).toBe(true);
      expect(yield* textOf(told)).toContain('refused[not-found]');
      const result = yield* called(direct, 'create_block', { title: 'Nowhere', parentId: 'ffffffff', json: true });
      expect(failed(result)).toBe(true);
      const refusal = yield* documentOf(result);
      expect(refusal.status).toBe('refused');
      expect(refusal.code).toBe('not-found');
      expect(String(refusal.reason)).toContain('ffffffff');
      expect(Array.isArray(refusal.unblock) && (refusal.unblock as unknown[]).length > 0).toBe(true);
    }),
  );

  it.effect('a CLI offered the pair finds an operation, reads its input and calls it, all in text', () =>
    Effect.gen(function* () {
      const { gemini, call } = yield* Bridges;
      const page = yield* mcpListTools(gemini, call);
      expect(page.tools.map((tool) => tool.name)).toEqual(['list_operations', 'call_operation']);
      const listed = yield* documentOf(yield* called(gemini, 'list_operations', { match: 'create_block', json: true }));
      const ids = (listed.operations as ReadonlyArray<{ id: string }>).map((entry) => entry.id);
      expect(ids).toEqual(['create_block']);
      const found = yield* textOf(yield* called(gemini, 'list_operations', { match: 'create_block' }));
      expect(found).toContain('create_block — ');
      expect(found).toMatch(/input: \{[^}]*title: string/u);
      const made = yield* called(gemini, 'call_operation', {
        operation: 'create_block',
        input: { title: 'Found in text', parentId: yield* rootOf() },
      });
      expect(yield* textOf(made)).toContain('Found in text');
    }),
  );

  it.effect('an id the catalog does not carry is refused at the field that named it', () =>
    Effect.gen(function* () {
      const { gemini } = yield* Bridges;
      const result = yield* called(gemini, 'call_operation', { operation: 'not_an_operation', input: {} });
      expect(failed(result)).toBe(true);
      expect(yield* textOf(result)).toContain('refused[operation-unknown]');
    }),
  );

  it.effect('a bridge with nothing to sign with refuses to start rather than serving unsigned', () =>
    Effect.gen(function* () {
      const { world, project } = yield* Bridges;
      const env = {
        [MCP_KEY_VARIABLE]: undefined,
        CLAUDE_CODE_SESSION_ID: undefined,
        CODEX_THREAD_ID: undefined,
        GROK_SESSION_ID: undefined,
      };
      const unsigned = yield* world.tagma(['mcp-serve', '--harness', 'gemini'], { cwd: project.root, env });
      expect(unsigned.code).toBe(2);
      expect(`${unsigned.err}${unsigned.out}`).toContain('mcp-unsigned');
      const claudeUnsigned = yield* world.tagma(['mcp-serve', '--harness', 'claude-code'], { cwd: project.root, env });
      expect(claudeUnsigned.code).toBe(2);
      expect(`${claudeUnsigned.err}${claudeUnsigned.out}`).toContain('CLAUDE_CODE_SESSION_ID');
    }),
  );

  it.effect('the harness is the one the declaration pinned, never the first variable the environment carries', () =>
    Effect.gen(function* () {
      const { world, project, direct } = yield* Bridges;
      expect(
        (yield* documentOf(
          yield* called(direct, 'create_block', { title: 'Written by the pinned harness', parentId: yield* rootOf(), json: true }),
        )).status,
      ).toBe('ok');
      const sessions = yield* world.tagma(['sessions', '--json'], { cwd: project.root });
      expect(sessions.code).toBe(0);
      expect(sessions.out).toContain('itest-codex-session');
      expect(sessions.out).not.toContain('itest-not-this-one');
    }),
  );

  it.effect('the bridge ends when its client closes stdio, leaving no process behind', () =>
    Effect.gen(function* () {
      const { project, environment } = yield* Bridges;
      const command = ['bun', join(import.meta.dir, '../../developer/cli.ts'), 'mcp-serve', '--harness', 'claude-code'];
      const child = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            Bun.spawn(command, {
              cwd: project.root,
              env: environment({ [MCP_KEY_VARIABLE]: 'itest-ending-key' }),
              stdin: 'pipe',
              stdout: 'pipe',
              stderr: 'pipe',
            }),
          catch: (cause) => new SpawnRefused({ command, cause }),
        }),
        (child) =>
          Effect.promise(async () => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            await child.exited;
          }),
      );
      const initialize = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'itest', version: '0' } },
      };
      child.stdin.write(`${JSON.stringify(initialize)}\n`);
      yield* Effect.promise(async () => {
        await child.stdin.flush();
      });
      const reader = yield* Effect.acquireRelease(
        Effect.sync(() => child.stdout.getReader()),
        (reader) => Effect.sync(() => reader.releaseLock()),
      );
      const answered = yield* Effect.promise(() => reader.read());
      expect(answered.done).toBe(false);
      yield* Effect.promise(async () => {
        await child.stdin.end();
      });
      expect(yield* Effect.promise(() => child.exited)).toBe(0);
      expect(child.signalCode).toBeNull();
    }),
  );
});
