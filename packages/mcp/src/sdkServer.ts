import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Effect, type Scope, Stream } from 'effect';
import { McpServeFailed } from './McpFailure';

export type McpServedTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>> & { readonly type: 'object' };
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  };
};

export type McpServedMedia = { readonly type: 'image'; readonly data: string; readonly mimeType: string };

export type McpServedResult = {
  readonly text: string;
  readonly media?: readonly McpServedMedia[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly isError?: boolean;
};

export type McpServerInput = {
  readonly name: string;
  readonly version: string;
  readonly tools: () => readonly McpServedTool[];
  readonly call: (
    tool: string,
    input: Readonly<Record<string, unknown>>,
    meta: Readonly<Record<string, unknown>>,
    requestId: string | number,
    signal: AbortSignal,
  ) => Promise<McpServedResult>;
};

export type StdioServerInput = McpServerInput & { readonly changes?: Stream.Stream<unknown, McpServeFailed> };

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const declared = (tool: McpServedTool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: { ...tool.inputSchema },
  annotations: tool.annotations === undefined ? undefined : { ...tool.annotations },
});

const answered = (result: McpServedResult) => ({
  content: [{ type: 'text' as const, text: result.text }, ...(result.media ?? []).map((medium) => ({ ...medium }))],
  structuredContent: result.structuredContent === undefined ? undefined : { ...result.structuredContent },
  _meta: result.meta === undefined ? undefined : { ...result.meta },
  isError: result.isError,
});

const handled = (server: Server, input: McpServerInput): Server => {
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: input.tools().map(declared) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    answered(
      await input.call(request.params.name, request.params.arguments ?? {}, request.params._meta ?? {}, extra.requestId, extra.signal),
    ),
  );
  return server;
};

export function mcpToolServer(input: McpServerInput): McpServer {
  const server = new McpServer({ name: input.name, version: input.version }, { capabilities: { tools: { listChanged: true } } });
  handled(server.server, input);
  return server;
}

type HttpServerInput = McpServerInput & { readonly bearer: string };

type McpHttpServing = { readonly url: string };

const MCP_PATH = '/mcp';

const answerHttp = async (input: HttpServerInput, request: Request): Promise<Response> => {
  if (request.headers.get('authorization') !== `Bearer ${input.bearer}`) return new Response('unauthorized', { status: 401 });
  if (new URL(request.url).pathname !== MCP_PATH) return new Response('not found', { status: 404 });
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
  const server = mcpToolServer(input);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const gone = Promise.withResolvers<Response>();
  const dropped = () => {
    void server.close();
    gone.resolve(new Response(null, { status: 499 }));
  };
  request.signal.addEventListener('abort', dropped, { once: true });
  try {
    return await Promise.race([transport.handleRequest(request), gone.promise]);
  } finally {
    request.signal.removeEventListener('abort', dropped);
    await server.close();
  }
};

export const serveMcpOverHttp = (input: HttpServerInput): Effect.Effect<McpHttpServing, McpServeFailed, Scope.Scope> =>
  Effect.map(
    Effect.acquireRelease(
      Effect.try({
        try: () => Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, fetch: (request) => answerHttp(input, request) }),
        catch: (error) => new McpServeFailed({ transport: 'http', reason: reasonOf(error) }),
      }),
      (served) => Effect.promise(() => served.stop(true)),
    ),
    (served) => ({ url: `http://127.0.0.1:${served.port}${MCP_PATH}` }),
  );

export const serveMcpOverStdio = Effect.fnUntraced(function* (input: StdioServerInput) {
  yield* Effect.scoped(
    Effect.gen(function* () {
      const closed = Promise.withResolvers<void>();
      const transport = new StdioServerTransport();
      const ended = () => {
        void transport.close();
      };
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const server = handled(
            new Server({ name: input.name, version: input.version }, { capabilities: { tools: { listChanged: true } } }),
            input,
          );
          server.onclose = () => closed.resolve();
          process.stdin.once('end', ended);
          process.stdin.once('close', ended);
          return server;
        }),
        (server) =>
          Effect.promise(async () => {
            process.stdin.off('end', ended);
            process.stdin.off('close', ended);
            await server.close();
          }),
      );
      const performed = (work: () => Promise<void>) =>
        Effect.tryPromise({ try: work, catch: (error) => new McpServeFailed({ transport: 'stdio', reason: reasonOf(error) }) });
      yield* performed(() => server.connect(transport));
      const stopped = Effect.promise(() => closed.promise);
      yield* input.changes === undefined
        ? stopped
        : Effect.raceFirst(
            stopped,
            Stream.runForEach(input.changes, () => performed(() => server.sendToolListChanged())),
          );
    }),
  );
});
