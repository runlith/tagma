import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Cause, Effect, Exit, Fiber, Scope } from 'effect';
import { type McpPalette, McpPool } from './McpPool';
import type { McpHttpServerDeclaration, McpStdioServerDeclaration } from './McpServerDeclaration';
import type { McpSdkCallResult } from './sdk';

const SERVER = resolve(import.meta.dir, '../test/mcpTestServer.ts');

const declare = (
  name: string,
  flags: readonly string[] = [],
  extra: Partial<McpStdioServerDeclaration> = {},
): McpStdioServerDeclaration => ({
  name,
  transport: 'stdio',
  command: process.execPath,
  args: [SERVER, ...flags],
  capabilities: { kinds: ['read'], mutates: false },
  enabled: true,
  ...extra,
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const until = Effect.fnUntraced(function* (condition: () => boolean) {
  while (!condition()) yield* Effect.sleep('50 millis');
  return true;
});

const names = (palette: McpPalette) => palette.map((entry) => entry.declaration.name).sort();

const servedHttp = (options: {
  readonly dieOnCall?: boolean;
  readonly refuseCalls?: boolean;
  readonly muteDelete?: boolean;
  readonly holdInitialize?: boolean;
}) => {
  let transport: WebStandardStreamableHTTPServerTransport | undefined;
  let dead = false;
  let deletes = 0;
  let reached = false;
  let released = false;
  let openHandshake: () => void = () => undefined;
  const handshake = new Promise<void>((resolve) => {
    openHandshake = resolve;
  });
  const open = async () => {
    if (transport) return transport;
    const server = new Server({ name: 'probe', version: '0.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'echo', inputSchema: { type: 'object' as const } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      if (options.refuseCalls) throw new McpError(ErrorCode.InvalidParams, 'the server refuses this call');
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });
    transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    await server.connect(transport);
    return transport;
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.method === 'DELETE') {
      deletes += 1;
      if (options.muteDelete) return new Promise<Response>(() => undefined);
    }
    const body = request.method === 'POST' ? await request.clone().text() : '';
    if (options.dieOnCall && body.includes('"method":"tools/call"')) dead = true;
    if (dead && request.method === 'POST') return new Response('gone', { status: 404 });
    if (options.holdInitialize && body.includes('"method":"initialize"')) {
      reached = true;
      await handshake;
    }
    return (await open()).handleRequest(request);
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch: fetchImpl,
    deletes: () => deletes,
    reached: () => reached,
    release: () => {
      released = true;
      openHandshake();
    },
    released: () => released,
  };
};

const httpDeclaration = (name: string): McpHttpServerDeclaration => ({
  name,
  transport: 'http',
  url: 'https://probe.invalid/mcp',
  capabilities: { kinds: ['network'], mutates: false },
  enabled: true,
  timeoutMs: 4_000,
});

const text = (result: McpSdkCallResult) =>
  'content' in result ? result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('') : String(result.toolResult);

describe('McpPool', () => {
  it.live(
    'connects without waiting, keeps an unchanged session, refreshes its tools, replaces changed declarations, and disables and removes it',
    Effect.fnUntraced(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'mcp-pool-'));
      const pidFile = join(dir, 'pid');
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));

      yield* pool.reconcile([declare('files', [], { env: { MCP_TEST_PID_FILE: pidFile } })]);
      expect(pool.states().map((state) => state.status)).toEqual(['connecting']);

      yield* pool.awaitHandshakes();
      expect(names(pool.paletteUnsafe())).toContain('files');
      expect(pool.paletteUnsafe()[0]?.descriptors.map((descriptor) => descriptor.name)).toContain('echo');
      expect(pool.states().map((state) => [state.status, state.tools > 0])).toEqual([['connected', true]]);
      expect(existsSync(pidFile)).toBe(true);
      const pid = Number(readFileSync(pidFile, 'utf8'));
      expect(alive(pid)).toBe(true);

      const files = declare('files', [], { env: { MCP_TEST_PID_FILE: pidFile } });
      yield* pool.reconcile([{ ...files }]);
      expect(names(pool.paletteUnsafe())).toEqual(['files']);
      expect(Number(readFileSync(pidFile, 'utf8'))).toBe(pid);

      const tools = () => pool.paletteUnsafe()[0]?.descriptors.map((descriptor) => descriptor.name) ?? [];
      expect(tools()).not.toContain('grown');
      yield* pool.call('files', 'grow', {});
      expect(yield* until(() => tools().includes('grown'))).toBe(true);
      expect(text(yield* pool.call('files', 'grown', {}))).toBe('the grown tool answered');

      const changed = { ...files, capabilities: { kinds: ['write'] as const, mutates: true } };
      yield* pool.reconcile([changed]);
      expect(yield* until(() => !alive(pid))).toBe(true);
      yield* pool.awaitHandshakes();
      expect(names(pool.paletteUnsafe())).toEqual(['files']);
      const replacement = Number(readFileSync(pidFile, 'utf8'));
      expect(replacement).not.toBe(pid);
      expect(alive(replacement)).toBe(true);
      expect(text(yield* pool.call('files', 'echo', { text: 'replaced' }))).toBe('replaced');

      yield* pool.reconcile([{ ...changed, enabled: false }]);
      expect(yield* until(() => !alive(replacement))).toBe(true);
      expect(pool.states().map((state) => [state.name, state.status, state.failure])).toEqual([['files', 'disabled', undefined]]);
      expect(pool.paletteUnsafe()).toEqual([]);

      yield* pool.reconcile([]);
      expect(names(pool.paletteUnsafe())).toEqual([]);
      expect(pool.states()).toEqual([]);
      const afterwards = yield* Effect.result(pool.call('files', 'echo', {}));
      expect(afterwards._tag === 'Failure' && afterwards.failure._tag).toBe('McpNotConnected');
      expect(yield* until(() => !alive(pid))).toBe(true);

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'a connect that never answers delays no caller, and closing the scope ends it',
    Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      yield* pool.reconcile([declare('mute', ['--hang'], { timeoutMs: 500 })]);
      expect(pool.paletteUnsafe()).toEqual([]);
      expect(pool.states().map((state) => state.status)).toEqual(['connecting']);
      yield* pool.awaitHandshakes();
      expect(pool.states()[0]?.status).toBe('failed');
      expect(pool.states()[0]?.failure?._tag).toBe('McpTimedOut');
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'repairs a killed server on the next call: one replacement answers two concurrent calls, and its tools leave the palette first',
    Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      yield* pool.reconcile([declare('files')]);
      yield* pool.awaitHandshakes();
      expect(names(pool.paletteUnsafe())).toContain('files');
      const pid = Number(text(yield* pool.call('files', 'pid', {})));
      process.kill(pid, 'SIGKILL');
      expect(yield* until(() => !alive(pid))).toBe(true);

      expect(yield* until(() => !names(pool.paletteUnsafe()).includes('files'))).toBe(true);
      const state = pool.states()[0];
      expect([state?.name, state?.status, state?.tools, state?.failure?._tag]).toEqual(['files', 'failed', 0, 'McpConnectFailed']);

      const answers = yield* Effect.all([pool.call('files', 'pid', {}), pool.call('files', 'pid', {})], { concurrency: 2 });
      const pids = answers.map((answer) => Number(text(answer)));
      expect(pids[0]).toBe(pids[1] as number);
      expect(pids[0]).not.toBe(pid);
      expect(pool.states().map((state) => [state.status, state.tools > 0])).toEqual([['connected', true]]);
      expect(names(pool.paletteUnsafe())).toEqual(['files']);
      yield* Scope.close(scope, Exit.void);
      expect(yield* until(() => !alive(pids[0] as number))).toBe(true);
    }),
  );

  it.live(
    'answers a reconcile that replaces a connect in flight without waiting for that connect',
    Effect.fnUntraced(function* () {
      const pidFile = join(mkdtempSync(join(tmpdir(), 'mcp-pool-')), 'pid');
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      yield* pool.reconcile([declare('mute', ['--hang'], { timeoutMs: 4_000, env: { MCP_TEST_PID_FILE: pidFile } })]);
      expect(pool.states().map((state) => state.status)).toEqual(['connecting']);
      expect(yield* until(() => existsSync(pidFile))).toBe(true);
      const pid = Number(readFileSync(pidFile, 'utf8'));

      yield* pool.reconcile([]);
      expect(pool.states()).toEqual([]);
      expect(yield* until(() => !alive(pid))).toBe(true);

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'registers nothing from an attempt whose server was removed and declared again while it ran',
    Effect.fnUntraced(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'mcp-pool-'));
      const firstPid = join(dir, 'first');
      const secondPid = join(dir, 'second');
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));

      yield* pool.reconcile([declare('files', ['--slow', '800'], { env: { MCP_TEST_PID_FILE: firstPid } })]);
      expect(yield* until(() => existsSync(firstPid))).toBe(true);
      const first = Number(readFileSync(firstPid, 'utf8'));
      yield* pool.reconcile([]);
      yield* pool.reconcile([declare('files', [], { env: { MCP_TEST_PID_FILE: secondPid } })]);

      yield* pool.awaitHandshakes();
      expect(names(pool.paletteUnsafe())).toContain('files');
      const second = Number(readFileSync(secondPid, 'utf8'));
      expect(yield* until(() => !alive(first))).toBe(true);
      expect(Number(text(yield* pool.call('files', 'pid', {})))).toBe(second);
      expect(pool.states().map((state) => [state.name, state.status])).toEqual([['files', 'connected']]);

      yield* Scope.close(scope, Exit.void);
      expect(yield* until(() => !alive(second))).toBe(true);
    }),
  );

  it.live(
    'answers a caller joining a failed connect with that connect failure, not with a state',
    Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      yield* pool.reconcile([declare('dying', ['--die', 'cannot find module left-pad'])]);
      expect(pool.states().map((state) => state.status)).toEqual(['connecting']);
      const answered = yield* Effect.result(pool.call('dying', 'echo', { text: 'hi' }));

      const failure = answered._tag === 'Failure' ? answered.failure : undefined;
      expect(failure?._tag).toBe('McpConnectFailed');
      expect(failure?._tag === 'McpConnectFailed' && failure.stderr).toBe('cannot find module left-pad');
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'ends an interrupted call at once, instead of pinging and rebuilding to three timeouts',
    Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      const started = join(mkdtempSync(join(tmpdir(), 'mcp-interrupted-')), 'started');
      yield* pool.reconcile([declare('frozen', [], { timeoutMs: 1_000, env: { MCP_TEST_HOLD_CALL: started } })]);
      yield* pool.awaitHandshakes();
      expect(pool.states()).toMatchObject([{ name: 'frozen', status: 'connected' }]);
      const pid = Number(text(yield* pool.call('frozen', 'pid', {})));

      const answered = yield* Effect.gen(function* () {
        const calling = yield* Effect.forkScoped(pool.call('frozen', 'echo', { text: 'hi' }));
        yield* until(() => existsSync(started));
        process.kill(pid, 'SIGSTOP');
        return yield* Fiber.interrupt(calling).pipe(Effect.andThen(Fiber.await(calling)));
      }).pipe(Effect.ensuring(Effect.sync(() => process.kill(pid, 'SIGCONT'))));

      expect(Exit.isFailure(answered) && Cause.hasInterruptsOnly(answered.cause)).toBe(true);
      expect(pool.states().map((state) => [state.name, state.status])).toEqual([['frozen', 'connected']]);

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'lets an interrupted call leave a connect it only joined, while that connect stands for everyone else',
    Effect.fnUntraced(function* () {
      const endpoint = servedHttp({ holdInitialize: true });
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make({ fetch: endpoint.fetch }).pipe(Scope.provide(scope));
      yield* pool.reconcile([httpDeclaration('slow')]);

      const leaving = yield* Effect.forkScoped(pool.call('slow', 'echo', { text: 'hi' }));
      const staying = yield* Effect.forkScoped(Effect.result(pool.call('slow', 'echo', { text: 'hi' })));
      expect(yield* until(() => endpoint.reached())).toBe(true);

      const left = yield* Fiber.interrupt(leaving).pipe(Effect.andThen(Fiber.await(leaving)));
      expect(Exit.isFailure(left) && Cause.hasInterruptsOnly(left.cause)).toBe(true);
      expect(endpoint.released()).toBe(false);

      endpoint.release();
      expect((yield* Fiber.join(staying))._tag).toBe('Success');
      expect(names(pool.paletteUnsafe())).toEqual(['slow']);

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'takes a session that dies under a call out of the palette as that call answers',
    Effect.fnUntraced(function* () {
      const endpoint = servedHttp({ dieOnCall: true });
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make({ fetch: endpoint.fetch }).pipe(Scope.provide(scope));
      yield* pool.reconcile([httpDeclaration('dying')]);
      yield* pool.awaitHandshakes();
      expect(pool.paletteUnsafe()).toHaveLength(1);

      const answered = yield* Effect.result(pool.call('dying', 'echo', {}));
      expect(answered._tag).toBe('Failure');
      expect(pool.paletteUnsafe()).toEqual([]);
      expect(pool.states().map((state) => state.status)).toEqual(['failed']);
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'leaves a server that merely refused a call standing, because refusing is not dying',
    Effect.fnUntraced(function* () {
      const endpoint = servedHttp({ refuseCalls: true });
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make({ fetch: endpoint.fetch }).pipe(Scope.provide(scope));
      yield* pool.reconcile([httpDeclaration('grumpy')]);
      yield* pool.awaitHandshakes();
      expect(pool.paletteUnsafe()).toHaveLength(1);

      const answered = yield* Effect.result(pool.call('grumpy', 'echo', {}));
      expect(answered._tag).toBe('Failure');
      expect(names(pool.paletteUnsafe())).toEqual(['grumpy']);
      expect(pool.states().map((state) => state.status)).toEqual(['connected']);
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'closes its owner scope in the abort\u2019s time while a handshake hangs, leaving no entry connecting',
    Effect.fnUntraced(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'mcp-pool-'));
      const pidFile = join(dir, 'pid');
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      yield* pool.reconcile([declare('mute', ['--hang'], { timeoutMs: 5_000, env: { MCP_TEST_PID_FILE: pidFile } })]);
      expect(yield* until(() => existsSync(pidFile))).toBe(true);
      const pid = Number(readFileSync(pidFile, 'utf8'));
      expect(pool.states().map((state) => state.status)).toEqual(['connecting']);

      yield* Scope.close(scope, Exit.void);
      expect(pool.states().map((state) => state.status)).not.toContain('connecting');
      expect(yield* until(() => !alive(pid))).toBe(true);
    }),
  );

  it.live(
    'closes its owner scope even against an endpoint that never answers the session DELETE',
    Effect.fnUntraced(function* () {
      const endpoint = servedHttp({ muteDelete: true });
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make({ fetch: endpoint.fetch }).pipe(Scope.provide(scope));
      yield* pool.reconcile([{ ...httpDeclaration('mute-delete'), timeoutMs: 500 }]);
      yield* pool.awaitHandshakes();
      expect(pool.paletteUnsafe()).toHaveLength(1);

      yield* Scope.close(scope, Exit.void);
      expect(endpoint.deletes()).toBe(1);
    }),
  );

  it.live(
    'answers McpNotConnected for a server nobody declared and for one declared disabled',
    Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      yield* pool.reconcile([declare('quiet', [], { enabled: false })]);
      const unknown = yield* Effect.result(pool.call('nobody', 'echo', {}));
      const disabled = yield* Effect.result(pool.call('quiet', 'echo', {}));
      expect(unknown._tag === 'Failure' && unknown.failure._tag === 'McpNotConnected' && unknown.failure.state).toBe('undeclared');
      expect(disabled._tag === 'Failure' && disabled.failure._tag === 'McpNotConnected' && disabled.failure.state).toBe('disabled');
      expect(pool.states().map((state) => [state.name, state.status])).toEqual([['quiet', 'disabled']]);
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'answers a reconcile only once the palette shows its list, even while another pass is running',
    Effect.fnUntraced(function* () {
      const held = servedHttp({ holdInitialize: true });
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make({ fetch: held.fetch }).pipe(Scope.provide(scope));
      const files = declare('files');
      yield* pool.reconcile([files]);
      yield* pool.awaitHandshakes();
      expect(names(pool.paletteUnsafe())).toContain('files');

      yield* pool.reconcile([]);
      expect(pool.paletteUnsafe()).toEqual([]);
      expect(pool.states()).toEqual([]);

      const slow = httpDeclaration('slow');
      yield* Effect.all([pool.reconcile([slow]), pool.reconcile([slow, files])], { concurrency: 'unbounded' });
      expect(held.released()).toBe(false);
      expect(
        pool
          .states()
          .map((state) => state.name)
          .sort(),
      ).toEqual(['files', 'slow']);
      held.release();
      yield* pool.reconcile([]);
      expect(pool.states()).toEqual([]);
      expect(pool.paletteUnsafe()).toEqual([]);

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.live(
    'coalesces reconciles fired together, and the last list is the one that stands',
    Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const pool = yield* McpPool.make().pipe(Scope.provide(scope));
      const a = declare('a');
      const b = declare('b');
      yield* Effect.all([pool.reconcile([a]), pool.reconcile([a, b]), pool.reconcile([b])], { concurrency: 'unbounded' });
      expect(pool.states().map((state) => state.name)).toEqual(['b']);
      yield* pool.awaitHandshakes();
      expect(names(pool.paletteUnsafe())).toContain('b');
      yield* Scope.close(scope, Exit.void);
    }),
  );
});
