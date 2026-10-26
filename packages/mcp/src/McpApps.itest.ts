import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { resolve } from 'node:path';
import { Deferred, Effect, Exit, Scope, Stream } from 'effect';
import { Tool, toolDisplay } from '@runlith/agent/tool';
import { McpPool } from './McpPool';
import { openMcpSession } from './McpSession';
import { mcpToolCatalog } from './mcpToolCatalog';
import { mcpRedactor } from './mcpRedactor';
import type { McpStdioServerDeclaration } from './McpServerDeclaration';

const declaration: McpStdioServerDeclaration = {
  name: 'app',
  transport: 'stdio',
  command: process.execPath,
  args: [resolve(import.meta.dir, '../test/mcpAppServer.ts')],
  capabilities: { kinds: ['read'], mutates: false },
  enabled: true,
};
const uri = 'ui://app/dashboard';

const next = <A>(stream: Stream.Stream<A>) => Stream.runCollect(stream.pipe(Stream.take(1)));

it.live(
  'MCP Apps metadata, resources and scoped shared subscriptions work over stdio without a Tagma SDK',
  Effect.fnUntraced(function* () {
    const session = yield* openMcpSession(declaration, { redact: mcpRedactor(['app-credential']) });
    const descriptor = session.descriptors.find((tool) => tool.name === 'dashboard');
    expect(descriptor?._meta).toEqual({ ui: { resourceUri: uri }, custom: { retained: true } });
    expect(descriptor?.outputSchema).toEqual({ type: 'object' });
    const catalog = mcpToolCatalog({
      projectId: 5,
      declaration,
      descriptors: session.descriptors,
      pool: { call: (_server, tool, args, options) => session.call(tool, args, options) },
    });
    expect(Object.keys(catalog.tools).sort()).toEqual(['both', 'dashboard', 'model']);
    expect(catalog.excluded.map((tool) => tool.tool).sort()).toEqual(['hidden', 'refresh']);
    const result = yield* session.call('dashboard', {});
    expect(result._meta).toEqual({ private: { token: '[redacted]' }, ui: { resourceUri: uri } });
    expect(yield* session.readResource(uri)).toEqual({
      contents: [
        {
          uri,
          mimeType: 'text/html;profile=mcp-app',
          text: '<!DOCTYPE html><html><body>Dashboard</body></html>',
          _meta: { ui: { prefersBorder: false, csp: { connectDomains: [] } }, token: '[redacted]' },
        },
      ],
      _meta: { revision: 0, token: '[redacted]' },
    });
    const listed = yield* session.listResources();
    expect(listed.nextCursor).toBe('listing');
    expect(listed.resources[0]?._meta).toEqual({
      ui: { csp: { connectDomains: ['https://app.example'] }, prefersBorder: true },
      token: '[redacted]',
    });
    const page = yield* session.listResources(listed.nextCursor);
    expect(page.resources[0]?.uri).toBe('ui://app/listing');
    const listing = yield* session.readResource('ui://app/listing');
    expect(listing.contents[0]?._meta).toEqual({ token: '[redacted]' });
    expect(page.resources[0]?._meta).toEqual(listed.resources[0]?._meta);
    const refusal = yield* Effect.flip(session.readResource('app://missing'));
    expect(refusal._tag).toBe('McpResourceFailed');
    expect(refusal.method).toBe('resources/read');
    expect(refusal.uri).toBe('app://missing');

    const first = yield* Scope.fork(yield* Effect.scope);
    const second = yield* Scope.fork(yield* Effect.scope);
    const other = yield* Scope.fork(yield* Effect.scope);
    yield* Effect.addFinalizer(() =>
      Effect.all([Scope.close(first, Exit.void), Scope.close(second, Exit.void), Scope.close(other, Exit.void)], { concurrency: 1 }),
    );
    const updates = yield* session.subscribeResource(uri).pipe(Scope.provide(first));
    expect(yield* next(updates)).toEqual([{ uri, _meta: { revision: 0 } }]);
    const shared = yield* session.subscribeResource(uri).pipe(Scope.provide(second));
    const state = yield* session.subscribeResource('app://state').pipe(Scope.provide(other));
    expect(yield* next(state)).toEqual([{ uri: 'app://state', _meta: { revision: 0 } }]);
    yield* session.call('refresh', {});
    expect(yield* next(updates)).toEqual([{ uri, _meta: { revision: 1, token: '[redacted]' } }]);
    expect(yield* next(shared)).toEqual([{ uri, _meta: { revision: 1, token: '[redacted]' } }]);
    expect(yield* next(state)).toEqual([{ uri: 'app://state', _meta: { revision: 1, token: '[redacted]' } }]);
    yield* session.call('refresh', {});
    expect(yield* next(updates)).toEqual([{ uri, _meta: { revision: 2, token: '[redacted]' } }]);
    yield* session.call('refresh', {});
    expect(yield* next(updates)).toEqual([{ uri, _meta: { revision: 3, token: '[redacted]' } }]);
    expect(yield* next(shared)).toEqual([{ uri, _meta: { revision: 3, token: '[redacted]' } }]);
    yield* Scope.close(first, Exit.void);
    yield* session.call('refresh', {});
    expect(yield* next(shared)).toEqual([{ uri, _meta: { revision: 4, token: '[redacted]' } }]);
    yield* Scope.close(second, Exit.void);
    const subscriptions = yield* session.readResource('app://subscriptions');
    expect(subscriptions.contents).toEqual([{ uri: 'app://subscriptions', text: '["app://state"]' }]);
    yield* Scope.close(other, Exit.void);
    expect((yield* session.readResource('app://subscriptions')).contents).toEqual([{ uri: 'app://subscriptions', text: '[]' }]);
    const rejected = yield* Effect.result(Effect.scoped(session.subscribeResource('app://missing')));
    expect(rejected._tag === 'Failure' && rejected.failure.method).toBe('resources/subscribe');
  }),
  10_000,
);

it.live(
  'the pool hosts an MCP App: its view resolves listing metadata and its calls reach only tools visible to the app',
  Effect.fnUntraced(function* () {
    const pool = yield* McpPool.make();
    yield* pool.reconcile([declaration]);
    yield* pool.call('app', 'model', {});
    const offered = (apps?: true) =>
      mcpToolCatalog({
        projectId: 5,
        declaration,
        descriptors: pool.paletteUnsafe()[0]?.descriptors ?? [],
        pool: { call: (server, tool, args, options) => pool.call(server, tool, args, options) },
        apps,
      }).tools.dashboard;
    const plain = offered();
    expect(plain === undefined ? undefined : toolDisplay(plain, {})?.app).toBeUndefined();
    const dashboard = offered(true);
    const app = dashboard === undefined ? undefined : toolDisplay(dashboard, {})?.app;
    expect(app).toMatchObject({ server: 'app', resource: uri });
    const view = { server: 'app', identity: app?.identity ?? '' };
    expect(app?.tool).toBe('dashboard');
    expect(yield* pool.appView(view, uri, undefined)).toEqual({
      html: '<!DOCTYPE html><html><body>Dashboard</body></html>',
      meta: { prefersBorder: false, csp: { connectDomains: [] } },
    });
    expect((yield* pool.appView(view, uri, 'dashboard')).tool).toMatchObject({ name: 'dashboard', outputSchema: { type: 'object' } });
    const execute = dashboard === undefined ? null : Tool.toolExecute(dashboard);
    if (execute === null) return yield* Effect.die(new Error('the dashboard tool has no body'));
    const answered = yield* execute(
      {},
      { toolCallId: 'call-1', caller: { agentId: 'agent', ownerId: 'owner', thread: null }, messages: [] },
    );
    expect(answered instanceof Tool.ToolAnswer ? answered.display?.app?.result : undefined).toEqual({
      content: [{ type: 'text', text: 'dashboard' }],
      structuredContent: { revision: 0 },
      _meta: { private: { token: 'app-credential' }, ui: { resourceUri: uri } },
    });
    expect((yield* pool.appView(view, 'ui://app/listing', undefined)).meta).toEqual({
      csp: { connectDomains: ['https://app.example'] },
      prefersBorder: true,
    });
    expect(yield* pool.appCall(view, 'refresh', {})).toMatchObject({ structuredContent: { revision: 1 } });
    expect((yield* Effect.flip(pool.appCall(view, 'model', {})))._tag).toBe('McpToolUnoffered');
    expect((yield* Effect.flip(pool.appCall(view, 'absent', {})))._tag).toBe('McpToolUnoffered');
    const notView = yield* Effect.flip(pool.appView(view, 'app://subscriptions', undefined));
    expect(notView._tag).toBe('McpResourceFailed');
    const watching = yield* Scope.fork(yield* Effect.scope);
    const updates = yield* pool.appSubscribe(view, 'app://state').pipe(Scope.provide(watching));
    expect(yield* next(updates)).toEqual([{ uri: 'app://state', _meta: { revision: 1 } }]);
    yield* pool.reconcile([{ ...declaration, timeoutMs: 9_000 }]);
    expect(yield* Stream.runCollect(updates)).toEqual([]);
    yield* Scope.close(watching, Exit.void);
    expect((yield* Effect.flip(pool.appView(view, uri, undefined)))._tag).toBe('McpServerReplaced');
    expect((yield* Effect.flip(pool.appCall(view, 'refresh', {})))._tag).toBe('McpServerReplaced');
    expect((yield* Effect.flip(pool.appRead(view, uri)))._tag).toBe('McpServerReplaced');
  }),
  10_000,
);

it.live(
  'a view document is read from its server once, and again only after the server says it changed',
  Effect.fnUntraced(function* () {
    const session = yield* openMcpSession(declaration);
    const reads = Effect.map(session.readResource('app://reads'), (read) => {
      const content = read.contents[0];
      return content !== undefined && 'text' in content ? content.text : undefined;
    });
    yield* Effect.all([session.appDocument(uri), session.appDocument(uri)], { concurrency: 'unbounded' });
    yield* session.appDocument(uri);
    expect(yield* reads).toBe('2');
    const state = yield* session.subscribeResource('app://state');
    yield* next(state);
    yield* session.call('refresh', {});
    yield* next(state);
    yield* session.appDocument(uri);
    expect(yield* reads).toBe('2');
    const updates = yield* session.subscribeResource(uri);
    yield* next(updates);
    expect((yield* session.appDocument(uri)).html).toContain('Dashboard');
    expect(yield* reads).toBe('3');
  }),
  10_000,
);

it.live(
  'every caller joining a resource subscription is admitted by the server, and the last to leave ends it as itself',
  Effect.fnUntraced(function* () {
    const session = yield* openMcpSession(declaration);
    const as = (projectId: number) => ({ caller: { kind: 'operator' as const, projectId, view: 'board' } });
    const text = (read: { readonly contents: readonly ({ readonly text: string } | { readonly blob: string })[] }) => {
      const content = read.contents[0];
      return content !== undefined && 'text' in content ? content.text : '';
    };
    const owner = yield* Scope.fork(yield* Effect.scope);
    const updates = yield* session.subscribeResource('app://project/2', as(2)).pipe(Scope.provide(owner));
    yield* next(updates);
    const stranger = yield* Effect.flip(Effect.scoped(session.subscribeResource('app://project/2', as(1))));
    expect(stranger._tag).toBe('McpResourceFailed');
    expect(text(yield* session.readResource('app://subscriptions'))).toBe('["app://project/2"]');
    yield* Scope.close(owner, Exit.void);
    expect(text(yield* session.readResource('app://subscriptions'))).toBe('[]');
    expect(JSON.parse(text(yield* session.readResource('app://callers'))).unsubscribe).toEqual(as(2).caller);
  }),
  10_000,
);

it.live(
  'a resource scope releases cleanly after its MCP transport has closed',
  Effect.fnUntraced(function* () {
    const session = yield* openMcpSession(declaration);
    const reader = yield* Scope.fork(yield* Effect.scope);
    yield* Effect.addFinalizer(() => Scope.close(reader, Exit.void));
    yield* session.subscribeResource(uri).pipe(Scope.provide(reader));
    const call = yield* Effect.result(session.call('exit', {}));
    expect(call._tag === 'Failure' && call.failure._tag).toBe('McpCallFailed');
    expect((yield* Deferred.await(session.closed))._tag).toBe('McpConnectFailed');
    const unavailable = yield* Effect.flip(Effect.scoped(session.subscribeResource(uri)));
    expect(unavailable._tag).toBe('McpResourceFailed');
    expect(unavailable.method).toBe('resources/subscribe');
    const released = yield* Effect.exit(Scope.close(reader, Exit.void));
    expect(released._tag).toBe('Success');
  }),
  10_000,
);
