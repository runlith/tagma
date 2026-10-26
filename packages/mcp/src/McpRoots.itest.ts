import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Deferred, Effect, Fiber, FileSystem } from 'effect';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { join, resolve } from 'node:path';
import { openMcpSession } from './McpSession';

it.live('one MCP session publishes concurrent callers roots before writes and revokes the last finished lease', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'mcp-roots-' });
    const first = join(home, 'thread-a');
    const second = join(home, 'thread-b');
    const workspace = join(home, 'checkout');
    yield* files.makeDirectory(workspace);
    yield* files.makeDirectory(first);
    yield* files.makeDirectory(second);
    const session = yield* openMcpSession({
      name: 'roots',
      transport: 'stdio',
      command: process.execPath,
      args: [resolve(import.meta.dir, '../test/mcpRootsServer.ts')],
      enabled: true,
      capabilities: { kinds: ['write'], mutates: true },
      timeoutMs: 5000,
    });
    yield* session.call('ready', {});
    const outside = yield* session.call('save', { path: join(home, 'outside.txt') });
    expect('isError' in outside && outside.isError).toBe(true);
    const replies = yield* Effect.all(
      [
        session.call('save', { path: join(first, 'shot.png') }, { roots: [first] }),
        session.call('save', { path: join(second, 'response.txt') }, { roots: [second] }),
      ],
      { concurrency: 2 },
    );
    for (const reply of replies) expect('isError' in reply && reply.isError === true).toBe(false);
    expect(yield* files.readFileString(join(first, 'shot.png'))).toBe('saved');
    expect(yield* files.readFileString(join(second, 'response.txt'))).toBe('saved');
    const again = yield* session.call('save', { path: join(first, 'again.txt') }, { roots: [second] });
    expect('isError' in again && again.isError === true).toBe(true);
    const held = yield* session
      .call('save', { path: join(workspace, 'shared.txt'), hold: true }, { roots: [workspace, second] })
      .pipe(Effect.forkChild);
    yield* session.call('waiting', {});
    const quick = yield* session.call('save', { path: join(first, 'quick.txt') }, { roots: [workspace, first] });
    expect('isError' in quick && quick.isError === true).toBe(false);
    yield* session.call('release', {});
    const shared = yield* Fiber.join(held);
    expect('isError' in shared && shared.isError === true).toBe(false);
    expect(yield* files.readFileString(join(workspace, 'shared.txt'))).toBe('saved');
    const revoked = yield* session.call('save', { path: join(workspace, 'revoked.txt') }, { roots: [second] });
    expect('isError' in revoked && revoked.isError === true).toBe(true);
    const renewed = yield* session.call('save', { path: join(second, 'again.txt') }, { roots: [second] });
    expect('isError' in renewed && renewed.isError === true).toBe(false);
    expect(yield* files.readFileString(join(second, 'again.txt'))).toBe('saved');
    yield* session.call('on-demand', {});
    for (const root of [first, second]) {
      const reply = yield* session.call('save', { path: join(root, 'on-demand.txt') }, { roots: [root] });
      expect('isError' in reply && reply.isError === true).toBe(false);
      expect(yield* files.readFileString(join(root, 'on-demand.txt'))).toBe('saved');
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a rejected release notification preserves the completed tool result and the next call can recover', () =>
  Effect.gen(function* () {
    const rejected = yield* Deferred.make<void>();
    let completed = false;
    let failing = true;
    const server = new Server({ name: 'roots-release', version: '0.0.0' }, { capabilities: { tools: {} } });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }));
    server.setNotificationHandler(RootsListChangedNotificationSchema, () => {});
    server.setRequestHandler(CallToolRequestSchema, () => {
      completed = true;
      return { content: [{ type: 'text', text: 'written' }] };
    });
    yield* Effect.acquireRelease(
      Effect.promise(() => server.connect(transport)),
      () => Effect.promise(() => server.close()),
    );
    const session = yield* openMcpSession(
      {
        name: 'roots-release',
        transport: 'http',
        url: 'https://roots.invalid/mcp',
        enabled: true,
        capabilities: { kinds: ['write'], mutates: true },
        timeoutMs: 1000,
      },
      {
        fetch: async (url, init) => {
          const request = new Request(String(url), init);
          const body = request.method === 'POST' ? ((await request.clone().json()) as { method?: string }) : undefined;
          if (completed && failing && body?.method === 'notifications/roots/list_changed') {
            Deferred.doneUnsafe(rejected, Effect.void);
            return new Response('unavailable', { status: 500 });
          }
          return transport.handleRequest(request);
        },
      },
    );
    const reply = yield* session.call('echo', {}, { roots: ['/workspace'] });
    yield* Deferred.await(rejected).pipe(Effect.timeout('2 seconds'));
    expect('content' in reply ? reply.content : []).toEqual([{ type: 'text', text: 'written' }]);
    failing = false;
    const recovered = yield* session.call('echo', {}, { roots: ['/workspace'] });
    expect('content' in recovered ? recovered.content : []).toEqual([{ type: 'text', text: 'written' }]);
  }),
);
