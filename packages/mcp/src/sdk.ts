import { type ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ReadBuffer } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { Duration, Effect, type Scope } from 'effect';
import { type McpCaller, mcpCallerMeta } from './mcpCallerMeta';
import { McpCallFailed, McpConnectFailed, McpResourceFailed, McpTimedOut, type McpTransportKind } from './McpFailure';
import { redactValue } from './mcpRedactor';
import type { McpResourcePage, McpResourceResult, McpResourceUpdated } from './mcpResources';
import { McpRoots } from './McpRoots';

const loadSdk = async () => {
  const [client, stdio, framing, http, protocol, types] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
    import('@modelcontextprotocol/sdk/shared/stdio.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/shared/protocol.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ]);
  return {
    Client: client.Client,
    framing: { ReadBuffer: framing.ReadBuffer, serializeMessage: framing.serializeMessage, environment: stdio.getDefaultEnvironment },
    StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    DEFAULT_REQUEST_TIMEOUT_MSEC: protocol.DEFAULT_REQUEST_TIMEOUT_MSEC,
    ErrorCode: types.ErrorCode,
    McpError: types.McpError,
    ResourceUpdatedNotificationSchema: types.ResourceUpdatedNotificationSchema,
    ResourceListChangedNotificationSchema: types.ResourceListChangedNotificationSchema,
    ListRootsRequestSchema: types.ListRootsRequestSchema,
  };
};

type Sdk = Awaited<ReturnType<typeof loadSdk>>;

let loading: Promise<Sdk> | undefined;

const unloadable = (server: string, transport: McpTransportKind) => (error: unknown) =>
  new McpConnectFailed({
    server,
    transport,
    reason: `the MCP SDK could not load: ${error instanceof Error ? error.message : String(error)}`,
  });

const sdkFor = (server: string, transport: McpTransportKind): Effect.Effect<Sdk, McpConnectFailed> =>
  Effect.tryPromise({
    try: () =>
      (loading ??= loadSdk().catch((error: unknown) => {
        loading = undefined;
        throw error;
      })),
    catch: unloadable(server, transport),
  });

const connected = (connection: McpSdkConnection): Effect.Effect<Sdk> => Effect.orDie(sdkFor(connection.server, connection.transportKind));

export type McpSdkDefaults = {
  readonly timeoutMs: number;
  readonly environment: Readonly<Record<string, string>>;
};

export const mcpSdkDefaults = (server: string, transport: McpTransportKind): Effect.Effect<McpSdkDefaults, McpConnectFailed> =>
  Effect.map(sdkFor(server, transport), (loaded) => ({
    timeoutMs: loaded.DEFAULT_REQUEST_TIMEOUT_MSEC,
    environment: loaded.framing.environment(),
  }));

export type McpRequestOptions = {
  readonly timeout: number;
  readonly roots?: readonly string[];
  readonly caller?: McpCaller;
  readonly redact?: (text: string) => string;
};

export type McpSdkToolDescriptor = {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>> & { readonly type: 'object' };
  readonly outputSchema?: Readonly<Record<string, unknown>> & { readonly type: 'object' };
  readonly _meta?: Readonly<Record<string, unknown>>;
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
  readonly execution?: {
    readonly taskSupport?: 'required' | 'optional' | 'forbidden';
  };
};

export type McpSdkContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  | { readonly type: 'audio'; readonly data: string; readonly mimeType: string }
  | {
      readonly type: 'resource';
      readonly resource: {
        readonly uri: string;
        readonly mimeType?: string;
        readonly text?: string;
        readonly blob?: string;
      };
    }
  | { readonly type: 'resource_link'; readonly uri: string; readonly name: string };

export type McpSdkCallResult =
  | {
      readonly content: readonly McpSdkContent[];
      readonly structuredContent?: Readonly<Record<string, unknown>>;
      readonly isError?: boolean;
      readonly _meta?: Readonly<Record<string, unknown>>;
    }
  | { readonly toolResult: unknown; readonly _meta?: Readonly<Record<string, unknown>> };

export type McpSdkToolPage = {
  readonly tools: readonly McpSdkToolDescriptor[];
  readonly nextCursor?: string;
};

export type McpStdioTransportInput = {
  readonly transport: 'stdio';
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly onStderr: (chunk: Uint8Array) => void;
};

export type McpHttpTransportInput = {
  readonly transport: 'http';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
};

export type McpTransportInput = McpStdioTransportInput | McpHttpTransportInput;

export type McpSdkConnection = {
  readonly server: string;
  readonly transportKind: McpTransportKind;
  readonly client: Client;
  readonly transport: GroupedStdioTransport | StreamableHTTPClientTransport;
  readonly childExit: Effect.Effect<void>;
  readonly roots: McpRoots;
  readonly scope: Scope.Scope;
};

type SdkCallResult = Awaited<ReturnType<Client['callTool']>>;
type SdkContentResult = Extract<SdkCallResult, { content: unknown }>;

const hasContent = (result: SdkCallResult): result is SdkContentResult => Array.isArray(result.content);

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const said = (options: McpRequestOptions, text: string): string => options.redact?.(text) ?? text;

const isRequestTimeout = (loaded: Sdk, error: unknown): boolean =>
  error instanceof loaded.McpError && error.code === loaded.ErrorCode.RequestTimeout;

const requestOptions = (signal: AbortSignal, options: McpRequestOptions) => ({ signal, timeout: options.timeout });

const connectFailed = (connection: McpSdkConnection, options: McpRequestOptions | undefined, error: unknown) =>
  new McpConnectFailed({
    server: connection.server,
    transport: connection.transportKind,
    reason: options === undefined ? reasonOf(error) : said(options, reasonOf(error)),
  });

type StdioFraming = {
  readonly ReadBuffer: new () => ReadBuffer;
  readonly serializeMessage: (message: JSONRPCMessage) => string;
  readonly environment: () => Record<string, string>;
};

type GroupedStdioParameters = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
};

const STDIO_GRACE_MS = 2_000;

const signalled = (group: number, signal: NodeJS.Signals): boolean => {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
};

const settledWithin = (closed: Promise<void>, ms: number): Promise<void> =>
  Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, ms).unref())]);

class GroupedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  readonly stderr = new PassThrough();
  private child: ChildProcess | undefined;
  private readonly buffer: ReadBuffer;

  constructor(
    private readonly parameters: GroupedStdioParameters,
    private readonly framing: StdioFraming,
  ) {
    this.buffer = new framing.ReadBuffer();
  }

  start(): Promise<void> {
    if (this.child !== undefined) return Promise.reject(new Error('the stdio transport is already started'));
    return new Promise((resolve, reject) => {
      const child = spawn(this.parameters.command, [...(this.parameters.args ?? [])], {
        env: { ...this.framing.environment(), ...this.parameters.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: true,
        cwd: this.parameters.cwd,
      });
      this.child = child;
      child.on('error', (error) => {
        reject(error);
        this.onerror?.(error);
      });
      child.on('spawn', () => resolve());
      child.on('close', () => {
        this.child = undefined;
        if (child.pid !== undefined) signalled(child.pid, 'SIGKILL');
        this.onclose?.();
      });
      child.stdin?.on('error', (error) => this.onerror?.(error));
      child.stdout?.on('data', (chunk: Buffer) => {
        this.buffer.append(chunk);
        this.read();
      });
      child.stdout?.on('error', (error) => this.onerror?.(error));
      child.stderr?.pipe(this.stderr);
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.child?.stdin;
      if (stdin === undefined || stdin === null) {
        reject(new Error('the stdio transport is not connected'));
        return;
      }
      if (stdin.write(this.framing.serializeMessage(message))) resolve();
      else stdin.once('drain', resolve);
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child !== undefined) {
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      child.stdin?.end();
      await settledWithin(closed, STDIO_GRACE_MS);
      const group = child.pid;
      if (group !== undefined && child.exitCode === null && child.signalCode === null) {
        signalled(group, 'SIGTERM');
        await settledWithin(closed, STDIO_GRACE_MS);
      }
      if (group !== undefined) signalled(group, 'SIGKILL');
    }
    this.buffer.clear();
  }

  private read(): void {
    for (;;) {
      try {
        const message = this.buffer.readMessage();
        if (message === null) return;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}

const childExitOf = (transport: GroupedStdioTransport): Effect.Effect<void> => {
  let spawned = false;
  let exited = false;
  let ended: () => void = () => undefined;
  const exit = new Promise<void>((resolve) => {
    ended = resolve;
  });
  transport.stderr.once('pipe', () => {
    spawned = true;
  });
  transport.onclose = () => {
    exited = true;
    ended();
  };
  return Effect.suspend(() => (spawned && !exited ? Effect.promise(() => exit) : Effect.void));
};

export type McpTransportHooks = {
  readonly onToolsChanged: () => void;
  readonly onClosed: () => void;
  readonly onResourceUpdated?: (update: McpResourceUpdated) => void;
  readonly onResourcesChanged?: () => void;
};

export const openMcpTransport = Effect.fn('mcp.openTransport')(
  (server: string, input: McpTransportInput, hooks: McpTransportHooks): Effect.Effect<McpSdkConnection, McpConnectFailed, Scope.Scope> =>
    Effect.flatMap(Effect.scope, (scope) =>
      Effect.flatMap(
        sdkFor(server, input.transport),
        ({
          Client,
          framing,
          StreamableHTTPClientTransport,
          ResourceUpdatedNotificationSchema,
          ResourceListChangedNotificationSchema,
          ListRootsRequestSchema,
        }) =>
          Effect.try({
            try: () => {
              const client = new Client(
                { name: '@runlith/mcp', version: '0.1.0' },
                {
                  capabilities: {
                    roots: { listChanged: true },
                    extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
                  },
                  listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => hooks.onToolsChanged() } },
                },
              );
              const roots = new McpRoots();
              client.setRequestHandler(ListRootsRequestSchema, () => roots.answer());
              client.onclose = () => {
                roots.close();
                hooks.onClosed();
              };
              client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) =>
                hooks.onResourceUpdated?.(notification.params),
              );
              client.setNotificationHandler(ResourceListChangedNotificationSchema, () => hooks.onResourcesChanged?.());
              if (input.transport === 'stdio') {
                const transport = new GroupedStdioTransport(
                  {
                    command: input.command,
                    args: input.args,
                    cwd: input.cwd,
                    env: input.env,
                  },
                  framing,
                );
                transport.stderr.on('data', (chunk: Uint8Array) => input.onStderr(chunk));
                return { server, transportKind: 'stdio' as const, client, transport, childExit: childExitOf(transport), roots, scope };
              }
              const transport = new StreamableHTTPClientTransport(new URL(input.url), {
                requestInit: input.headers === undefined ? undefined : { headers: { ...input.headers } },
                fetch: input.fetch,
                reconnectionOptions: {
                  maxReconnectionDelay: 30_000,
                  initialReconnectionDelay: 1_000,
                  reconnectionDelayGrowFactor: 1.5,
                  maxRetries: 0,
                },
              });
              return { server, transportKind: 'http' as const, client, transport, childExit: Effect.void, roots, scope };
            },
            catch: (error) => new McpConnectFailed({ server, transport: input.transport, reason: reasonOf(error) }),
          }),
      ),
    ),
);

export const mcpConnect = Effect.fn('mcp.connect')(
  (connection: McpSdkConnection, options: McpRequestOptions): Effect.Effect<void, McpConnectFailed | McpTimedOut> =>
    Effect.flatMap(connected(connection), (loaded) =>
      Effect.tryPromise({
        try: (signal) => connection.client.connect(connection.transport, requestOptions(signal, options)),
        catch: (error) =>
          isRequestTimeout(loaded, error)
            ? new McpTimedOut({ server: connection.server, ms: options.timeout })
            : connectFailed(connection, options, error),
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(options.timeout),
        orElse: () => Effect.fail(new McpTimedOut({ server: connection.server, ms: options.timeout })),
      }),
      Effect.onError(() => mcpClose(connection, options.timeout, options.redact)),
    ),
);

export const mcpListTools = Effect.fn('mcp.listTools')(
  (
    connection: McpSdkConnection,
    options: McpRequestOptions,
    cursor?: string,
  ): Effect.Effect<McpSdkToolPage, McpConnectFailed | McpTimedOut> =>
    Effect.flatMap(connected(connection), (loaded) =>
      Effect.tryPromise({
        try: (signal) => connection.client.listTools(cursor === undefined ? undefined : { cursor }, requestOptions(signal, options)),
        catch: (error) =>
          isRequestTimeout(loaded, error)
            ? new McpTimedOut({ server: connection.server, ms: options.timeout })
            : connectFailed(connection, options, error),
      }),
    ).pipe(
      Effect.map((result) => ({
        tools: result.tools,
        nextCursor: result.nextCursor,
      })),
    ),
);

const notifyRoots = Effect.fn('mcp.notifyRoots')((connection: McpSdkConnection, options: McpRequestOptions) =>
  Effect.suspend(() => {
    const revision = connection.roots.pending();
    if (revision === undefined) return Effect.void;
    return Effect.tryPromise({
      try: () => connection.client.sendRootsListChanged(),
      catch: (error) => new McpCallFailed({ server: connection.server, tool: 'roots/list', reason: said(options, reasonOf(error)) }),
    }).pipe(
      Effect.tap(() => Effect.sync(() => connection.roots.notified(revision))),
      Effect.timeoutOrElse({
        duration: Duration.millis(options.timeout),
        orElse: () => Effect.fail(new McpTimedOut({ server: connection.server, tool: 'roots/list', ms: options.timeout })),
      }),
    );
  }),
);

const notifyReleasedRoots = (connection: McpSdkConnection, options: McpRequestOptions) =>
  notifyRoots(connection, options).pipe(
    Effect.catch((failure) => Effect.logWarning('Released MCP roots could not be announced', { server: connection.server, failure })),
    Effect.forkIn(connection.scope),
    Effect.asVoid,
  );

export const mcpCallTool = Effect.fn('mcp.callTool')(
  (
    connection: McpSdkConnection,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    options: McpRequestOptions,
  ): Effect.Effect<McpSdkCallResult, McpCallFailed | McpTimedOut> =>
    Effect.acquireUseRelease(
      Effect.sync(() => connection.roots.retain(options.roots ?? [])),
      () =>
        Effect.flatMap(Effect.andThen(notifyRoots(connection, options), connected(connection)), (loaded) =>
          Effect.tryPromise({
            try: (signal) =>
              connection.client.callTool(
                { name: tool, arguments: { ...args }, ...callerOf(options) },
                undefined,
                requestOptions(signal, options),
              ),
            catch: (error) =>
              isRequestTimeout(loaded, error)
                ? new McpTimedOut({ server: connection.server, tool, ms: options.timeout })
                : new McpCallFailed({ server: connection.server, tool, reason: said(options, reasonOf(error)) }),
          }),
        ).pipe(
          Effect.map((result): McpSdkCallResult =>
            hasContent(result)
              ? {
                  content: result.content.map((part) => {
                    const scrubbed = part._meta === undefined ? part : { ...part, _meta: redactValue(part._meta, options.redact) };
                    if (scrubbed.type === 'text') return { ...scrubbed, text: said(options, scrubbed.text) };
                    if (scrubbed.type === 'resource_link') {
                      return { ...scrubbed, uri: said(options, scrubbed.uri), name: said(options, scrubbed.name) };
                    }
                    if (scrubbed.type === 'resource') {
                      return {
                        ...scrubbed,
                        resource: {
                          ...scrubbed.resource,
                          uri: said(options, scrubbed.resource.uri),
                          ...('text' in scrubbed.resource ? { text: said(options, scrubbed.resource.text) } : {}),
                        },
                      };
                    }
                    return scrubbed;
                  }),
                  structuredContent:
                    result.structuredContent === undefined ? undefined : redactValue(result.structuredContent, options.redact),
                  isError: result.isError,
                  _meta: result._meta === undefined ? undefined : redactValue(result._meta, options.redact),
                }
              : {
                  toolResult: redactValue(result.toolResult, options.redact),
                  _meta: result._meta === undefined ? undefined : redactValue(result._meta, options.redact),
                },
          ),
        ),
      (lease) => Effect.andThen(Effect.sync(lease.release), notifyReleasedRoots(connection, options)),
    ),
);

const callerOf = (options: McpRequestOptions) => (options.caller === undefined ? {} : { _meta: mcpCallerMeta(options.caller) });

const resourceFailure = (
  connection: McpSdkConnection,
  uri: string | undefined,
  method: McpResourceFailed['method'],
  options: McpRequestOptions,
  error: unknown,
) =>
  new McpResourceFailed({
    server: connection.server,
    uri: uri === undefined ? undefined : said(options, uri),
    method,
    reason: said(options, reasonOf(error)),
  });

export const mcpListResources = Effect.fn('mcp.listResources')(
  (connection: McpSdkConnection, options: McpRequestOptions, cursor?: string): Effect.Effect<McpResourcePage, McpResourceFailed> =>
    Effect.tryPromise({
      try: (signal) => connection.client.listResources(cursor === undefined ? undefined : { cursor }, requestOptions(signal, options)),
      catch: (error) => resourceFailure(connection, undefined, 'resources/list', options, error),
    }).pipe(Effect.map((result) => redactValue(result, options.redact))),
);

export const mcpReadResource = Effect.fn('mcp.readResource')(
  (connection: McpSdkConnection, uri: string, options: McpRequestOptions): Effect.Effect<McpResourceResult, McpResourceFailed> =>
    Effect.tryPromise({
      try: (signal) => connection.client.readResource({ uri, ...callerOf(options) }, requestOptions(signal, options)),
      catch: (error) => resourceFailure(connection, uri, 'resources/read', options, error),
    }).pipe(
      Effect.map((result) => ({
        contents: result.contents.map((content) => ({
          ...content,
          uri: said(options, content.uri),
          ...('text' in content ? { text: said(options, content.text) } : {}),
          _meta: content._meta === undefined ? undefined : redactValue(content._meta, options.redact),
        })),
        _meta: result._meta === undefined ? undefined : redactValue(result._meta, options.redact),
      })),
    ),
);

export const mcpSubscribeResource = Effect.fn('mcp.subscribeResource')(
  (connection: McpSdkConnection, uri: string, options: McpRequestOptions): Effect.Effect<void, McpResourceFailed> =>
    Effect.tryPromise({
      try: (signal) => connection.client.subscribeResource({ uri, ...callerOf(options) }, requestOptions(signal, options)),
      catch: (error) => resourceFailure(connection, uri, 'resources/subscribe', options, error),
    }).pipe(Effect.asVoid),
);

export const mcpUnsubscribeResource = Effect.fn('mcp.unsubscribeResource')(
  (connection: McpSdkConnection, uri: string, options: McpRequestOptions): Effect.Effect<void, McpResourceFailed> =>
    Effect.tryPromise({
      try: (signal) => connection.client.unsubscribeResource({ uri, ...callerOf(options) }, requestOptions(signal, options)),
      catch: (error) => resourceFailure(connection, uri, 'resources/unsubscribe', options, error),
    }).pipe(Effect.asVoid),
);

export const mcpPing = Effect.fn('mcp.ping')(
  (connection: McpSdkConnection, options: McpRequestOptions): Effect.Effect<void, McpCallFailed | McpTimedOut> =>
    Effect.flatMap(connected(connection), (loaded) =>
      Effect.tryPromise({
        try: (signal) => connection.client.ping(requestOptions(signal, options)),
        catch: (error) =>
          isRequestTimeout(loaded, error)
            ? new McpTimedOut({ server: connection.server, ms: options.timeout })
            : new McpCallFailed({ server: connection.server, tool: 'ping', reason: said(options, reasonOf(error)) }),
      }),
    ).pipe(Effect.asVoid),
);

export const mcpClose = Effect.fn('mcp.close')((
  connection: McpSdkConnection,
  timeout: number,
  redact?: (text: string) => string,
): Effect.Effect<void> => {
  const transport = connection.transport;
  const terminate = Effect.flatMap(connected(connection), ({ StreamableHTTPClientTransport }) =>
    transport instanceof StreamableHTTPClientTransport
      ? Effect.tryPromise({
          try: () => transport.terminateSession(),
          catch: (error) => connectFailed(connection, { timeout, redact }, error),
        }).pipe(
          Effect.tapError((failure) =>
            Effect.logWarning('MCP session termination failed during close', { server: connection.server, failure }),
          ),
          Effect.ignore,
          Effect.timeoutOrElse({
            duration: Duration.millis(timeout),
            orElse: () => Effect.logWarning('MCP session termination did not finish before transport close', { server: connection.server }),
          }),
        )
      : Effect.void,
  );
  return terminate.pipe(
    Effect.ensuring(
      Effect.tryPromise({
        try: () => connection.client.close(),
        catch: (error) => connectFailed(connection, { timeout, redact }, error),
      }).pipe(
        Effect.tapError((failure) => Effect.logWarning('MCP transport close failed', { server: connection.server, failure })),
        Effect.ignore,
        Effect.andThen(connection.childExit),
      ),
    ),
  );
});
