import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Effect } from 'effect';
import { MCP_NEEDS_SIGN_IN } from './McpAuth';
import { McpPool, type McpReconcileLive, mcpReconcileActions } from './McpPool';
import type { McpHttpServerDeclaration, McpServerDeclaration, McpStdioServerDeclaration } from './McpServerDeclaration';

const CHALLENGE = 'Bearer resource_metadata="https://probe.invalid/.well-known/oauth-protected-resource/mcp", scope="tools:read"';

const guarded = (accepted: string) =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.headers.get('authorization') !== `Bearer ${accepted}`)
      return new Response('', { status: 401, headers: { 'www-authenticate': CHALLENGE } });
    const server = new Server({ name: 'guarded', version: '0.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' as const } }] }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  }) as unknown as typeof globalThis.fetch;

const guardedDeclaration: McpHttpServerDeclaration = {
  name: 'guarded',
  transport: 'http',
  url: 'https://probe.invalid/mcp',
  capabilities: { kinds: ['network'], mutates: false },
  enabled: true,
};

describe('McpPool sign-in', () => {
  it.live(
    'a Bearer challenge reads needs-sign-in with its scope, and a rejected token is traded once for the fresh one it connects with',
    Effect.fnUntraced(function* () {
      let held: string | undefined;
      const rejected: string[] = [];
      const pool = yield* McpPool.make({
        fetch: guarded('fresh'),
        auth: () => ({
          bearer: () => Effect.succeed(held),
          rejected: (token) =>
            Effect.sync(() => {
              rejected.push(token);
              held = token === 'stale' ? 'fresh' : undefined;
              return held ?? MCP_NEEDS_SIGN_IN;
            }),
        }),
      });

      yield* pool.reconcile([guardedDeclaration]);
      yield* pool.awaitHandshakes();
      const [refused] = pool.states();
      expect(refused?.status).toBe('needs-sign-in');
      expect(refused?.failure).toMatchObject({
        _tag: 'McpNeedsSignIn',
        scope: 'tools:read',
        resourceMetadata: 'https://probe.invalid/.well-known/oauth-protected-resource/mcp',
      });

      held = 'stale';
      yield* pool.reconnect('guarded');
      expect(pool.states().map((state) => [state.status, state.tools])).toEqual([['connected', 1]]);
      expect(rejected).toEqual(['stale']);
    }),
  );
});

const declare = (name: string): McpStdioServerDeclaration => ({
  name,
  transport: 'stdio',
  command: 'server',
  capabilities: { kinds: ['read'], mutates: false },
  enabled: true,
});
const live = (entries: readonly (readonly [McpServerDeclaration, McpReconcileLive['status']])[]) =>
  new Map(entries.map(([declaration, status]) => [declaration.name, { declaration, status }]));

describe('mcpReconcileActions', () => {
  const files = declare('files');
  const search = declare('search');
  test('removes declarations no longer named and starts newly named ones', () => {
    expect(mcpReconcileActions(live([[files, 'connected']]), [search])).toEqual([
      { kind: 'remove', name: 'files' },
      { kind: 'start', declaration: search },
    ]);
  });
  test('leaves connecting, connected and signed-out servers under equal declarations alone', () => {
    expect(mcpReconcileActions(live([[files, 'connected']]), [{ ...files }])).toEqual([]);
    expect(mcpReconcileActions(live([[files, 'connecting']]), [{ ...files }])).toEqual([]);
    expect(mcpReconcileActions(live([[files, 'needs-sign-in']]), [{ ...files }])).toEqual([]);
  });
  test('restarts changed declarations and failed servers', () => {
    const reclassified: McpServerDeclaration = { ...files, capabilities: { kinds: ['write'], mutates: true } };
    expect(mcpReconcileActions(live([[files, 'connected']]), [reclassified])).toEqual([{ kind: 'start', declaration: reclassified }]);
    expect(mcpReconcileActions(live([[files, 'failed']]), [files])).toEqual([{ kind: 'start', declaration: files }]);
  });
  test('disables a declaration once and starts it again when re-enabled', () => {
    const silenced: McpServerDeclaration = { ...files, enabled: false };
    expect(mcpReconcileActions(live([[files, 'connected']]), [silenced])).toEqual([{ kind: 'disable', declaration: silenced }]);
    expect(mcpReconcileActions(live([[silenced, 'disabled']]), [silenced])).toEqual([]);
    expect(mcpReconcileActions(new Map(), [silenced])).toEqual([{ kind: 'disable', declaration: silenced }]);
    expect(mcpReconcileActions(live([[silenced, 'disabled']]), [files])).toEqual([{ kind: 'start', declaration: files }]);
  });
});
