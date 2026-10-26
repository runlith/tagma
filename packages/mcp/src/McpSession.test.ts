import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Logger } from 'effect';
import { openMcpSession } from './McpSession';
import { mcpRedactor } from './mcpRedactor';
import { mcpAnswer } from './mcpToolCatalog';

const secret = 'credential"\\value\n';
const content = [
  { type: 'text', text: secret },
  { type: 'image', data: 'AQID', mimeType: 'image/png' },
  { type: 'audio', data: 'AQID', mimeType: 'audio/wav' },
  { type: 'resource', resource: { uri: `https://host/${secret}`, blob: 'AQID' } },
];
const structuredContent = { nested: [{ token: secret, enabled: true }, null, 4], count: 2 };

const fetch: NonNullable<Parameters<typeof openMcpSession>[1]>['fetch'] = async (_url, init) => {
  if (init?.method === 'DELETE') throw new Error(`rejected ${secret}`);
  if (init?.method !== 'POST') return new Response(null, { status: 405 });
  const input = JSON.parse(String(init.body));
  if (input.id === undefined) return new Response(null, { status: 202 });
  if (input.method === 'initialize') {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: input.id,
        result: {
          protocolVersion: input.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'memory', version: '1' },
        },
      },
      { headers: { 'mcp-session-id': 'memory' } },
    );
  }
  if (input.method === 'tools/list') {
    return Response.json({
      jsonrpc: '2.0',
      id: input.id,
      result: {
        tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
      },
    });
  }
  if (input.method === 'tools/call' && input.params.name === 'echo') {
    return Response.json({ jsonrpc: '2.0', id: input.id, result: { content, structuredContent, isError: true } });
  }
  return Response.json({ jsonrpc: '2.0', id: input.id, error: { code: -32603, message: `rejected ${secret}` } });
};

it.live(
  'session results and call, ping and abort failures keep resolved credentials out of textual evidence',
  Effect.fnUntraced(function* () {
    const redact = mcpRedactor([secret, 'AQID']);
    const session = yield* openMcpSession(
      {
        name: 'memory',
        transport: 'http',
        url: 'https://mcp.invalid',
        capabilities: { kinds: ['read'], mutates: false },
        enabled: true,
      },
      { fetch, redact },
    );
    const answer = yield* session.call('echo', {});
    expect(answer).toEqual({
      content: [
        { type: 'text', text: '[redacted]' },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
        { type: 'audio', data: 'AQID', mimeType: 'audio/wav' },
        { type: 'resource', resource: { uri: 'https://host/[redacted]', blob: 'AQID' } },
      ],
      structuredContent: { nested: [{ token: '[redacted]', enabled: true }, null, 4], count: 2 },
      isError: true,
    });
    const shown = mcpAnswer(answer);
    expect(shown.failed).toBe(true);
    expect(shown.media.map((image) => [...image.bytes])).toEqual([[1, 2, 3]]);
    for (const call of [session.call('fail', {}), session.ping()]) {
      const failure = yield* Effect.flip(call);
      expect(failure._tag).toBe('McpCallFailed');
      expect(failure.message).not.toContain(secret);
      expect(failure.message).toContain('[redacted]');
    }
    const logged: unknown[] = [];
    yield* session.close().pipe(Effect.withLogger(Logger.make(({ message }) => void logged.push(message))));
    const evidence = JSON.stringify(logged);
    expect(evidence).toContain('[redacted]');
    expect(evidence).not.toContain('credential');
  }),
);

it.live(
  'a server that answers initialize but never takes the initialized notification fails the open at its declared timeout',
  Effect.fnUntraced(function* () {
    const stalled: NonNullable<Parameters<typeof openMcpSession>[1]>['fetch'] = (url, init) => {
      if (init?.method === 'POST' && JSON.parse(String(init.body)).method === 'notifications/initialized') {
        return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
      }
      return fetch(url, init);
    };
    const failure = yield* Effect.flip(
      Effect.scoped(
        openMcpSession(
          {
            name: 'stalled',
            transport: 'http',
            url: 'https://mcp.invalid',
            capabilities: { kinds: ['read'], mutates: false },
            enabled: true,
            timeoutMs: 200,
          },
          { fetch: stalled, redact: mcpRedactor([secret]) },
        ),
      ),
    );
    expect(failure._tag).toBe('McpTimedOut');
  }),
);

test('structured and legacy answers redact string leaves before JSON encoding', () => {
  const replacement = 'safe"\\\n';
  const redact = (text: string) => text.replaceAll(secret, replacement);
  const value = { nested: [{ token: secret }, null, 3], ok: true };
  const expected = { nested: [{ token: replacement }, null, 3], ok: true };
  const answer = mcpAnswer({ content: [], structuredContent: value }, redact);
  expect(JSON.parse(answer.text)).toEqual(expected);
  expect(answer.value).toEqual({ text: answer.text, structuredContent: expected });
  const legacy = mcpAnswer({ toolResult: value }, redact);
  expect(JSON.parse(legacy.text)).toEqual(expected);
  expect(value.nested[0]).toEqual({ token: secret });
});
