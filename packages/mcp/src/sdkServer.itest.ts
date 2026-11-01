import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Effect } from 'effect';
import { serveMcpOverHttp } from './sdkServer';

const TOKEN = 'secret-token';

const post = (url: string, authorization: string | undefined) =>
  Effect.promise(() =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );

it.live('a loopback MCP server refuses a request without its bearer, lists its tools and hands a call to the input with its meta', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls: { tool: string; input: unknown; meta: unknown }[] = [];
      const { url } = yield* serveMcpOverHttp({
        name: 'tagma',
        version: '1',
        bearer: TOKEN,
        tools: () => [{ name: 'echo', description: 'Echoes.', inputSchema: { type: 'object', properties: {} } }],
        call: async (tool, input, meta) => {
          calls.push({ tool, input, meta });
          return { text: 'echoed' };
        },
      });
      expect(url.startsWith('http://127.0.0.1:')).toBe(true);
      expect((yield* post(url, undefined)).status).toBe(401);
      expect((yield* post(url, 'Bearer wrong')).status).toBe(401);
      const client = new Client({ name: 'probe', version: '1' });
      yield* Effect.acquireRelease(
        Effect.promise(() =>
          client.connect(
            new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }),
          ),
        ),
        () => Effect.promise(() => client.close()),
      );
      const listed = yield* Effect.promise(() => client.listTools());
      expect(listed.tools.map((tool) => tool.name)).toEqual(['echo']);
      const answered = yield* Effect.promise(() => client.callTool({ name: 'echo', arguments: { a: 1 }, _meta: { callId: 'call-1' } }));
      expect(answered.content).toEqual([{ type: 'text', text: 'echoed' }]);
      expect(calls).toMatchObject([{ tool: 'echo', input: { a: 1 }, meta: { callId: 'call-1' } }]);
    }),
  ),
);
