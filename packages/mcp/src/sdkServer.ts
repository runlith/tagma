import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Effect, Stream } from 'effect';
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
