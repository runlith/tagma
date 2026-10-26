import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync, mkdtempSync, readFileSync, rmSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { Cause, Effect, Exit, Fiber, PubSub, Scope } from 'effect';
import type { McpFailure } from './McpFailure';
import type { McpStdioServerDeclaration } from './McpServerDeclaration';
import { openMcpSession } from './McpSession';
import { mcpCallTool, mcpClose, mcpConnect, openMcpTransport, type McpSdkCallResult } from './sdk';

const SPAWN_BUDGET_MS = 30_000;
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

const text = (result: McpSdkCallResult) =>
  'content' in result ? result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('') : String(result.toolResult);

const failed = <A>(effect: Effect.Effect<A, McpFailure, never>) =>
  Effect.result(effect).pipe(Effect.map((result) => (result._tag === 'Failure' ? result.failure : undefined)));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const gone = Effect.fnUntraced(function* (pid: number) {
  while (alive(pid)) yield* Effect.sleep('50 millis');
  return true;
});

describe('McpSession', () => {
  it.live(
    'connects, lists descriptors as the server spelled them, calls a tool, and ends the child with its scope',
    Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const session = yield* openMcpSession(declare('probe')).pipe(Scope.provide(scope));
      const search = session.descriptors.find((descriptor) => descriptor.name === 'search');
      expect(search?.inputSchema).toEqual({ type: 'object', properties: { q: { type: 'string' } }, required: ['q'] });
      expect(search?.annotations).toEqual({ destructiveHint: false, readOnlyHint: true });
      expect(session.descriptors.find((descriptor) => descriptor.name === 'echo')?.title).toBe('Echo');

      expect(text(yield* session.call('echo', { text: 'hello' }))).toBe('hello');
      const pid = Number(text(yield* session.call('pid', {})));
      expect(alive(pid)).toBe(true);
      const grandchild = Number(text(yield* session.call('spawn', {})));
      expect(alive(grandchild)).toBe(true);

      yield* Scope.close(scope, Exit.void);
      expect(yield* gone(pid)).toBe(true);
      expect(yield* gone(grandchild)).toBe(true);
    }),
  );

  it.live(
    'ends an interrupted call at once, and answers the request timeout as its own failure',
    Effect.fnUntraced(function* () {
      const program = Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* openMcpTransport(
            'slow',
            { transport: 'stdio', command: process.execPath, args: [SERVER], onStderr: () => {} },
            { onToolsChanged: () => {}, onClosed: () => {} },
          );
          yield* Effect.addFinalizer(() => mcpClose(connection, SPAWN_BUDGET_MS));
          yield* mcpConnect(connection, { timeout: SPAWN_BUDGET_MS });
          const calling = yield* Effect.forkChild(mcpCallTool(connection, 'sleep', { ms: 5_000 }, { timeout: 5_000 }));
          yield* Effect.sleep('50 millis');
          yield* Fiber.interrupt(calling);
          const interrupted = yield* Fiber.await(calling);
          const expired = yield* failed(mcpCallTool(connection, 'sleep', { ms: 5_000 }, { timeout: 300 }));
          return { interrupted, expired };
        }),
      );
      const { interrupted, expired } = yield* program;
      expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
      expect(expired?._tag).toBe('McpTimedOut');
      expect(expired?._tag === 'McpTimedOut' && expired.ms).toBe(300);
    }),
  );

  it.live(
    'fails the connect of a server whose initialize never answers, with the timeout it ran under',
    Effect.fnUntraced(function* () {
      const failure = yield* failed(Effect.scoped(openMcpSession(declare('mute', ['--hang'], { timeoutMs: 300 }))));
      expect(failure?._tag).toBe('McpTimedOut');
      expect(failure?._tag === 'McpTimedOut' && failure.ms).toBe(300);
      expect(failure?._tag === 'McpTimedOut' && failure.tool).toBeUndefined();
    }),
  );

  it.live(
    'ends an interrupted handshake at once rather than waiting out the timeout',
    Effect.fnUntraced(function* () {
      const opening = yield* Effect.forkScoped(Effect.scoped(openMcpSession(declare('mute', ['--hang'], { timeoutMs: 5_000 }))));
      yield* Effect.sleep(100);
      const ended = yield* Fiber.interrupt(opening).pipe(Effect.andThen(Fiber.await(opening)));
      expect(Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause)).toBe(true);
    }),
  );

  it.live(
    'leaves no child running once an interrupted connect has ended, even one that ignores its stdin closing',
    Effect.fnUntraced(function* () {
      const home = mkdtempSync(join(tmpdir(), 'mcp-session-'));
      const pidFile = join(home, 'pid');
      const spawned = Promise.withResolvers<number>();
      const watcher = watch(home, () => {
        if (!existsSync(pidFile)) return;
        const pid = Number(readFileSync(pidFile, 'utf8'));
        if (pid > 0) spawned.resolve(pid);
      });
      const opening = yield* Effect.forkScoped(
        Effect.scoped(
          openMcpSession(declare('wedged', ['--hang', '--no-exit'], { timeoutMs: SPAWN_BUDGET_MS, env: { MCP_TEST_PID_FILE: pidFile } })),
        ),
      );
      yield* Effect.addFinalizer(() =>
        Fiber.interrupt(opening).pipe(
          Effect.andThen(
            Effect.sync(() => {
              watcher.close();
              rmSync(home, { recursive: true, force: true });
            }),
          ),
        ),
      );
      const pid = yield* Effect.promise(() => spawned.promise);
      const ended = yield* Fiber.interrupt(opening).pipe(Effect.andThen(Fiber.await(opening)));
      expect(Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause)).toBe(true);
      expect(alive(pid)).toBe(false);
    }),
  );

  it.live(
    'gives the child the allowlist plus the declaration, and no other variable of this process',
    Effect.fnUntraced(function* () {
      const previous = process.env.MCP_TEST_LEAK;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.MCP_TEST_LEAK;
          else process.env.MCP_TEST_LEAK = previous;
        }),
      );
      process.env.MCP_TEST_LEAK = 'must not reach the child';
      const seen = yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openMcpSession(declare('envprobe', [], { env: { API_TOKEN: 'x' } }));
          return JSON.parse(text(yield* session.call('env', {}))) as string[];
        }),
      );
      expect(seen).toContain('API_TOKEN');
      expect(seen).toContain('HOME');
      expect(seen).toContain('PATH');
      expect(seen).not.toContain('MCP_TEST_LEAK');
      const allowlist = new Set(['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER', 'API_TOKEN']);
      const bunOwn = (name: string) => name.startsWith('BUN_') || name === '_' || name === 'NODE_ENV' || name === 'PWD';
      expect(seen.filter((name) => !allowlist.has(name) && !bunOwn(name))).toEqual([]);
    }),
  );

  it.live(
    'answers a connect failure carrying the spawn error for a command that does not exist',
    Effect.fnUntraced(function* () {
      const failure = yield* failed(
        Effect.scoped(openMcpSession({ ...declare('missing'), command: 'no-such-mcp-server-binary', args: [] })),
      );
      expect(failure?._tag).toBe('McpConnectFailed');
      expect(failure?._tag === 'McpConnectFailed' && failure.reason).toContain('no-such-mcp-server-binary');
    }),
  );

  it.live(
    'carries the last lines a dying child wrote on the connect failure',
    Effect.fnUntraced(function* () {
      const failure = yield* failed(
        Effect.scoped(openMcpSession(declare('dying', ['--die', 'cannot find module left-pad'], { timeoutMs: 2_000 }))),
      );
      expect(failure?._tag).toBe('McpConnectFailed');
      expect(failure?._tag === 'McpConnectFailed' && failure.stderr).toBe('cannot find module left-pad');
    }),
  );

  it.live(
    'ends a tool list that never ends, naming the bound it hit, and registers no half-read catalog',
    Effect.fnUntraced(function* () {
      const repeated = yield* failed(Effect.scoped(openMcpSession(declare('loop', ['--cursor-loop'], { timeoutMs: 4_000 }))));
      expect(repeated?._tag).toBe('McpConnectFailed');
      expect(repeated?._tag === 'McpConnectFailed' && repeated.reason).toContain('a second time');

      const walking = yield* failed(Effect.scoped(openMcpSession(declare('walk', ['--empty-pages'], { timeoutMs: 4_000 }))));
      expect(walking?._tag).toBe('McpConnectFailed');
      expect(walking?._tag === 'McpConnectFailed' && walking.reason).toContain('added no tool');

      const flooding = yield* failed(
        Effect.scoped(openMcpSession(declare('flood', ['--flood-tools'], { timeoutMs: 4_000, maxCatalogBytes: 1024 }))),
      );
      expect(flooding?._tag).toBe('McpConnectFailed');
      expect(flooding?._tag === 'McpConnectFailed' && flooding.reason).toContain('1024 bytes');
    }),
  );

  it.live(
    'bounds the stderr tail in bytes, keeps the last of it whole, and writes none of it to this process',
    Effect.fnUntraced(function* () {
      const wrote: string[] = [];
      const own = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: unknown) => {
        wrote.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      let failure: McpFailure | undefined;
      try {
        const chunks = Math.ceil(TOOL_OUTPUT_MAX_BYTES / Buffer.byteLength('щедро'.repeat(64))) + 1;
        failure = yield* failed(Effect.scoped(openMcpSession(declare('loud', ['--flood', String(chunks)], { timeoutMs: 2_000 }))));
      } finally {
        process.stderr.write = own;
      }

      expect(failure?._tag).toBe('McpConnectFailed');
      const tail = failure?._tag === 'McpConnectFailed' ? (failure.stderr ?? '') : '';
      expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
      expect(tail).toContain('щедро');
      expect(tail.endsWith('module not found: left-pad')).toBe(true);
      expect(tail).not.toContain('\uFFFD');
      expect(wrote.join('')).not.toContain('щедро');
    }),
  );

  it.live(
    'publishes on tools/list_changed and shows the new tool after a refresh',
    Effect.fnUntraced(function* () {
      const program = Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openMcpSession(declare('growing'));
          const changes = yield* PubSub.subscribe(session.changes);
          const before = session.descriptors.map((descriptor) => descriptor.name);
          yield* session.call('grow', {});
          yield* PubSub.take(changes);
          const after = (yield* session.refresh()).map((descriptor) => descriptor.name);
          return { before, after, held: session.descriptors.map((descriptor) => descriptor.name) };
        }),
      );
      const { before, after, held } = yield* program;
      expect(before).not.toContain('grown');
      expect(after).toContain('grown');
      expect(held).toEqual(after);
    }),
  );
});
