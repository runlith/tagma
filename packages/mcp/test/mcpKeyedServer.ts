import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const accepted = new Set(process.argv.slice(2).map((token) => `Bearer ${token}`));

const opened = async (authorization: string) => {
  const server = new Server({ name: 'keyed', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'whoami', description: 'Answers the authorization this call carried.', inputSchema: { type: 'object' as const } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text' as const, text: authorization }] }));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport;
};

const served = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: async (request) => {
    const authorization = request.headers.get('authorization') ?? '';
    if (!accepted.has(authorization)) return new Response(`refused ${authorization}`, { status: 401 });
    return (await opened(authorization)).handleRequest(request);
  },
});

process.stdout.write(`${served.port}\n`);
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
