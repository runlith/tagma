import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'mcp-app', version: '1' }, { capabilities: { tools: {}, resources: { subscribe: true } } });
const subscriptions = new Set<string>();
let revision = 0;
let reads = 0;
const callers: Record<string, unknown> = {};
const uri = 'ui://app/dashboard';
const mimeType = 'text/html;profile=mcp-app';
const html = '<!DOCTYPE html><html><body>Dashboard</body></html>';
const secret = 'app-credential';

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const capability = server.getClientCapabilities()?.extensions?.['io.modelcontextprotocol/ui'];
  if (!Array.isArray(capability?.mimeTypes) || !capability.mimeTypes.includes(mimeType)) {
    throw new McpError(ErrorCode.InvalidParams, 'MCP Apps capability is required');
  }
  return {
    tools: [
      {
        name: 'dashboard',
        description: 'Shows the dashboard.',
        inputSchema: { type: 'object' as const },
        outputSchema: { type: 'object' as const },
        _meta: { ui: { resourceUri: uri }, custom: { retained: true } },
      },
      {
        name: 'refresh',
        description: 'Refreshes the state.',
        inputSchema: { type: 'object' as const },
        _meta: { ui: { visibility: ['app'] } },
      },
      {
        name: 'model',
        description: 'Answers the model.',
        inputSchema: { type: 'object' as const },
        _meta: { ui: { visibility: ['model'] } },
      },
      {
        name: 'both',
        description: 'Answers the model and the view.',
        inputSchema: { type: 'object' as const },
        _meta: { ui: { visibility: ['model', 'app'] } },
      },
      { name: 'hidden', description: 'Answers nobody.', inputSchema: { type: 'object' as const }, _meta: { ui: { visibility: [] } } },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'exit') await server.close();
  if (request.params.name === 'refresh') {
    revision += 1;
    for (const subscribed of subscriptions) {
      await server.notification({
        method: 'notifications/resources/updated',
        params: { uri: subscribed, _meta: { revision, token: secret } },
      });
    }
  }
  return {
    content: [{ type: 'text' as const, text: 'dashboard' }],
    structuredContent: { revision },
    _meta: { private: { token: secret }, ui: { resourceUri: uri } },
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async (request) => ({
  resources: [
    {
      uri: request.params?.cursor === 'listing' ? 'ui://app/listing' : uri,
      name: 'dashboard',
      mimeType,
      _meta: { ui: { csp: { connectDomains: ['https://app.example'] }, prefersBorder: true }, token: secret },
    },
  ],
  nextCursor: request.params?.cursor === 'listing' ? undefined : 'listing',
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === 'app://subscriptions') {
    return { contents: [{ uri: request.params.uri, text: JSON.stringify([...subscriptions].sort()) }] };
  }
  if (request.params.uri === 'app://reads') return { contents: [{ uri: request.params.uri, text: String(reads) }] };
  if (request.params.uri === 'app://callers') return { contents: [{ uri: request.params.uri, text: JSON.stringify(callers) }] };
  callers.read = request.params._meta?.['runlith/caller'];
  if (request.params.uri === uri) reads += 1;
  if (request.params.uri !== uri && request.params.uri !== 'app://state' && request.params.uri !== 'ui://app/listing')
    throw new McpError(ErrorCode.InvalidParams, 'unknown resource');
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType,
        text: html,
        _meta: {
          ui: request.params.uri === 'ui://app/listing' ? undefined : { prefersBorder: false, csp: { connectDomains: [] } },
          token: secret,
        },
      },
    ],
    _meta: { revision, token: secret },
  };
});

const projectOf = (caller: unknown): unknown =>
  typeof caller === 'object' && caller !== null && 'projectId' in caller ? caller.projectId : undefined;

server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  const caller = request.params._meta?.['runlith/caller'];
  const owned = /^app:\/\/project\/(\d+)$/u.exec(request.params.uri);
  if (owned !== null && projectOf(caller) !== Number(owned[1])) throw new McpError(ErrorCode.InvalidParams, 'another project');
  if (owned === null && request.params.uri !== uri && request.params.uri !== 'app://state') {
    throw new McpError(ErrorCode.InvalidParams, 'unknown resource');
  }
  subscriptions.add(request.params.uri);
  callers.subscribe = caller;
  await server.notification({ method: 'notifications/resources/updated', params: { uri: request.params.uri, _meta: { revision } } });
  return {};
});

server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  subscriptions.delete(request.params.uri);
  callers.unsubscribe = request.params._meta?.['runlith/caller'];
  return {};
});

await server.connect(new StdioServerTransport());
