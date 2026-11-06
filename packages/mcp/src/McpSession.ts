import type { McpCaller } from './mcpCallerMeta';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { Clock, Deferred, Duration, Effect, PubSub, type Scope, Semaphore, Stream } from 'effect';
import type { McpAuth } from './McpAuth';
import { type McpCallFailed, McpConnectFailed, type McpNeedsSignIn, McpResourceFailed, McpTimedOut } from './McpFailure';
import type { McpServerDeclaration } from './McpServerDeclaration';
import { redactValue } from './mcpRedactor';
import type { McpResourcePage, McpResourceResult, McpResourceUpdated } from './mcpResources';
import { MCP_APP_DOCUMENT_MAX_LENGTH, type McpAppDirectory, type McpAppView, mcpAppDirectory, mcpAppDocument } from './mcpApps';
import type { McpRoots } from './McpRoots';
import {
  type McpRequestOptions,
  type McpSdkCallResult,
  type McpSdkConnection,
  type McpSdkToolDescriptor,
  type McpTransportInput,
  mcpCallTool,
  mcpClose,
  mcpConnect,
  mcpListTools,
  mcpListResources,
  mcpPing,
  mcpReadResource,
  mcpSubscribeResource,
  mcpSyncRoots,
  mcpUnsubscribeResource,
  mcpSdkDefaults,
  openMcpTransport,
} from './sdk';

export const MCP_DEFAULT_CATALOG_BYTES = 4 * 1024 * 1024;

export type McpToolAnnotations = {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
};

export type McpToolDescriptor = {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly _meta?: Readonly<Record<string, unknown>>;
  readonly annotations?: McpToolAnnotations;
  readonly execution?: { readonly taskSupport?: 'required' | 'optional' | 'forbidden' };
};

export type McpCallOptions = {
  readonly caller?: McpCaller;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly roots?: readonly string[];
  readonly timeoutMs?: number;
};

export type McpSessionFailure = McpConnectFailed | McpTimedOut | McpNeedsSignIn;

class StderrTail {
  private chunks: Uint8Array[] = [];
  private bytes = 0;

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
    while (this.bytes > TOOL_OUTPUT_MAX_BYTES && this.chunks.length > 1) {
      this.bytes -= this.chunks.shift()?.byteLength ?? 0;
    }
    const only = this.chunks[0];
    if (this.bytes > TOOL_OUTPUT_MAX_BYTES && only !== undefined) {
      const kept = only.subarray(only.byteLength - TOOL_OUTPUT_MAX_BYTES);
      this.chunks = [kept];
      this.bytes = kept.byteLength;
    }
  }

  get tail(): string | undefined {
    if (this.bytes === 0) return undefined;
    const joined = new Uint8Array(this.bytes);
    let at = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, at);
      at += chunk.byteLength;
    }
    const trimmed = new TextDecoder()
      .decode(joined)
      .replace(/^\uFFFD+/, '')
      .trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
}

const describe = (descriptor: McpSdkToolDescriptor): McpToolDescriptor => ({
  name: descriptor.name,
  title: (descriptor.title ?? descriptor.annotations?.title) || undefined,
  description: descriptor.description,
  inputSchema: descriptor.inputSchema,
  outputSchema: descriptor.outputSchema,
  _meta: descriptor._meta,
  annotations: descriptor.annotations,
  execution: descriptor.execution,
});

const refusedListing = (connection: McpSdkConnection, reason: string) =>
  new McpConnectFailed({ server: connection.server, transport: connection.transportKind, reason });

const listAll = Effect.fn('McpSession.listAll')(
  function* (connection: McpSdkConnection, options: McpRequestOptions, maxCatalogBytes: number) {
    const descriptors: McpToolDescriptor[] = [];
    const asked = new Set<string>();
    let bytes = 0;
    let cursor: string | undefined;
    while (true) {
      const page = yield* mcpListTools(connection, options, cursor);
      const before = descriptors.length;
      for (const tool of page.tools) {
        const described = redactValue(describe(tool), options.redact);
        bytes += Buffer.byteLength(JSON.stringify(described), 'utf8');
        descriptors.push(described);
      }
      if (bytes > maxCatalogBytes) {
        return yield* refusedListing(connection, `the tool list passed ${maxCatalogBytes} bytes, more than Tagma holds for one server`);
      }
      const next = page.nextCursor;
      if (next === undefined) return descriptors as readonly McpToolDescriptor[];
      if (asked.has(next)) {
        return yield* refusedListing(connection, `the server answered the cursor ${JSON.stringify(next)} a second time`);
      }
      if (descriptors.length === before) {
        return yield* refusedListing(connection, 'a page of the tool list added no tool and asked for another');
      }
      asked.add(next);
      cursor = next;
    }
  },
  (work, connection, options) =>
    work.pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(options.timeout),
        orElse: () => Effect.fail(new McpTimedOut({ server: connection.server, ms: options.timeout })),
      }),
    ),
);

type ResourceSubscription = {
  readonly updates: PubSub.PubSub<McpResourceUpdated>;
  readonly callers: Map<string, { readonly caller: McpCaller | undefined; readers: number }>;
};

export type McpSession = ReturnType<typeof makeMcpSession>;

type SessionInput = {
  readonly server: string;
  readonly descriptors: readonly McpToolDescriptor[];
  readonly changes: PubSub.PubSub<void>;
  readonly closed: Deferred.Deferred<McpConnectFailed>;
  readonly timeoutMs: number;
  readonly maxCatalogBytes: number;
  readonly connection: McpSdkConnection;
  readonly resources: Map<string, ResourceSubscription>;
  readonly subscriptions: Semaphore.Semaphore;
  readonly options: McpSessionOptions;
};

const makeMcpSession = (input: SessionInput) => {
  const { server, descriptors, changes, closed, timeoutMs, maxCatalogBytes, connection, resources, subscriptions, options } = input;
  const { redact } = options;
  let current = descriptors;
  let disposed = false;
  let directory: McpAppDirectory | undefined;
  let listings = 0;
  let answeredAt = 0;
  const documents = new Map<string, { readonly view: McpAppView; readonly weight: number }>();
  const loading = new Map<string, object>();
  let documentsLength = 0;

  const under = (options: McpCallOptions): McpRequestOptions => ({
    timeout: options.timeoutMs ?? timeoutMs,
    caller: options.caller,
    meta: options.meta,
    redact,
  });

  const heard = <A, E>(request: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.tap(request, () =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        answeredAt = now;
      }),
    );

  const answeredWithin = (ms: number, now: number): boolean => !disposed && !Deferred.isDoneUnsafe(closed) && now - answeredAt <= ms;

  const call = (tool: string, args: Readonly<Record<string, unknown>>, options: McpCallOptions = {}) =>
    heard(mcpCallTool(connection, tool, args, under(options)));

  const listResources = (cursor?: string, options: McpCallOptions = {}): Effect.Effect<McpResourcePage, McpResourceFailed> =>
    heard(mcpListResources(connection, under(options), cursor));

  const readResource = (uri: string, options: McpCallOptions = {}): Effect.Effect<McpResourceResult, McpResourceFailed> =>
    heard(mcpReadResource(connection, uri, under(options)));

  const appDocument = Effect.fn('McpSession.appDocument')((uri: string, options: McpCallOptions = {}) =>
    Effect.suspend(() => {
      const known = documents.get(uri);
      if (known !== undefined) {
        documents.delete(uri);
        documents.set(uri, known);
        return Effect.succeed(known.view);
      }
      const ticket = {};
      const listing = listings;
      loading.set(uri, ticket);
      return mcpAppDocument(server, uri, {
        read: (read) => readResource(read),
        directory: appDirectory({}),
      }).pipe(
        Effect.tap((view) =>
          Effect.sync(() => {
            if (loading.get(uri) === ticket && listing === listings) keepDocument(uri, view);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (loading.get(uri) === ticket) loading.delete(uri);
          }),
        ),
      );
    }),
  );

  const keepDocument = (uri: string, view: McpAppView): void => {
    dropDocument(uri);
    const weight = uri.length + view.html.length + JSON.stringify(view.meta).length;
    documents.set(uri, { view, weight });
    documentsLength += weight;
    for (const [held, kept] of documents) {
      if (documentsLength <= MCP_APP_DOCUMENT_MAX_LENGTH || held === uri) return;
      documents.delete(held);
      documentsLength -= kept.weight;
    }
  };

  const dropDocument = (uri: string): void => {
    const kept = documents.get(uri);
    if (kept === undefined) return;
    documents.delete(uri);
    documentsLength -= kept.weight;
  };

  const appDirectory = Effect.fn('McpSession.appDirectory')((options: McpCallOptions = {}) =>
    Effect.suspend(() => {
      const known = directory;
      if (known !== undefined) return Effect.succeed(known);
      const asked = listings;
      return mcpAppDirectory((cursor) => listResources(cursor, options), maxCatalogBytes).pipe(
        Effect.tap((listed) =>
          Effect.sync(() => {
            if (asked === listings) directory = listed;
          }),
        ),
      );
    }),
  );

  const subscribeResource = Effect.fn('McpSession.subscribeResource')((uri: string, options: McpCallOptions = {}) => {
    const key = JSON.stringify(options.caller ?? null);
    const acquire = Effect.gen(function* () {
      if (disposed || Deferred.isDoneUnsafe(closed)) {
        return yield* new McpResourceFailed({ server, uri, method: 'resources/subscribe', reason: 'the session is closed' });
      }
      let entry = resources.get(uri);
      const first = entry === undefined;
      if (entry === undefined) {
        entry = { updates: yield* PubSub.sliding<McpResourceUpdated>(1), callers: new Map() };
        resources.set(uri, entry);
      }
      const reader = yield* PubSub.subscribe(entry.updates);
      const admitted = entry.callers.get(key);
      if (admitted === undefined) {
        const created = entry;
        yield* mcpSubscribeResource(connection, uri, under(options)).pipe(
          Effect.onError(() =>
            first ? Effect.sync(() => resources.delete(uri)).pipe(Effect.andThen(PubSub.shutdown(created.updates))) : Effect.void,
          ),
        );
        entry.callers.set(key, { caller: options.caller, readers: 1 });
      } else {
        admitted.readers += 1;
      }
      return Stream.fromSubscription(reader);
    }).pipe(subscriptions.withPermits(1));
    return Effect.acquireRelease(acquire, () => releaseResource(uri, key));
  });

  const releaseResource = Effect.fn('McpSession.releaseResource')(function* (uri: string, key: string): Effect.fn.Return<void> {
    const entry = resources.get(uri);
    const admitted = entry?.callers.get(key);
    if (entry === undefined || admitted === undefined) return;
    admitted.readers -= 1;
    if (admitted.readers > 0) return;
    entry.callers.delete(key);
    if (entry.callers.size > 0) return;
    resources.delete(uri);
    const release = Deferred.isDoneUnsafe(closed)
      ? Effect.void
      : mcpUnsubscribeResource(connection, uri, under(admitted.caller === undefined ? {} : { caller: admitted.caller })).pipe(
          Effect.catchTag('McpResourceFailed', (failure) => (Deferred.isDoneUnsafe(closed) ? Effect.void : Effect.die(failure))),
        );
    yield* release.pipe(Effect.ensuring(PubSub.shutdown(entry.updates)));
  }, subscriptions.withPermits(1));

  const ping = (options: McpCallOptions = {}): Effect.Effect<void, McpCallFailed | McpTimedOut | McpNeedsSignIn> =>
    heard(mcpPing(connection, under(options)));

  const syncRoots = (): Effect.Effect<void, McpCallFailed | McpTimedOut | McpNeedsSignIn> => heard(mcpSyncRoots(connection, under({})));

  const refresh = Effect.fn('McpSession.refresh')((options: McpCallOptions = {}) =>
    heard(listAll(connection, under(options), maxCatalogBytes)).pipe(
      Effect.mapError((failure) => scrubbed(failure, redact)),
      Effect.tap((descriptors) =>
        Effect.sync(() => {
          current = descriptors;
        }),
      ),
    ),
  );

  const close = Effect.fn('McpSession.close')(function* (): Effect.fn.Return<void> {
    disposed = true;
    yield* mcpClose(connection, timeoutMs, redact);
    yield* PubSub.shutdown(changes);
    for (const entry of resources.values()) yield* PubSub.shutdown(entry.updates);
    resources.clear();
  }, subscriptions.withPermits(1));
  return {
    server,
    changes,
    closed,
    timeoutMs,
    maxCatalogBytes,
    get descriptors() {
      return current;
    },
    answeredWithin,
    call,
    listResources,
    readResource,
    appDocument,
    forgetDocument: (uri: string) => {
      loading.delete(uri);
      dropDocument(uri);
    },
    appDirectory,
    forgetListing: () => {
      directory = undefined;
      listings += 1;
      loading.clear();
      documents.clear();
      documentsLength = 0;
    },
    subscribeResource,
    ping,
    syncRoots,
    refresh,
    close,
  } as const;
};

export type McpSessionOptions = {
  readonly fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  readonly redact?: (text: string) => string;
  readonly roots?: McpRoots;
  readonly auth?: (server: string) => McpAuth | undefined;
};

const transportInput = (
  declaration: McpServerDeclaration,
  stderr: StderrTail,
  options: McpSessionOptions,
  environment: Readonly<Record<string, string>>,
): McpTransportInput =>
  declaration.transport === 'stdio'
    ? {
        transport: 'stdio',
        command: declaration.command,
        args: declaration.args,
        cwd: declaration.cwd,
        env: { ...environment, ...declaration.env },
        onStderr: (chunk) => stderr.push(chunk),
      }
    : {
        transport: 'http',
        url: declaration.url,
        headers: declaration.headers,
        fetch: options.fetch,
        auth: options.auth?.(declaration.name),
      };

const withStderr = (failure: McpSessionFailure, stderr: StderrTail): McpSessionFailure =>
  failure._tag === 'McpConnectFailed' && failure.stderr === undefined && stderr.tail !== undefined
    ? new McpConnectFailed({ ...failure, stderr: stderr.tail })
    : failure;

const scrubbed = (failure: McpSessionFailure, redact: ((text: string) => string) | undefined): McpSessionFailure => {
  if (redact === undefined || failure._tag !== 'McpConnectFailed') return failure;
  return new McpConnectFailed({
    ...failure,
    reason: redact(failure.reason),
    stderr: failure.stderr === undefined ? undefined : redact(failure.stderr),
  });
};

const acquire = Effect.fn('McpSession.acquire')(function* (declaration: McpServerDeclaration, options: McpSessionOptions) {
  const redact = options.redact;
  const defaults = yield* mcpSdkDefaults(declaration.name, declaration.transport).pipe(
    Effect.mapError((failure) => scrubbed(failure, redact)),
  );
  const timeout = declaration.timeoutMs ?? defaults.timeoutMs;
  const stderr = new StderrTail();
  const changes = yield* PubSub.unbounded<void>();
  const resources = new Map<string, ResourceSubscription>();
  const subscriptions = yield* Semaphore.make(1);
  const closed = yield* Deferred.make<McpConnectFailed>();
  const input = transportInput(declaration, stderr, options, defaults.environment);
  let opened: McpSession | undefined;
  const connection = yield* openMcpTransport(
    declaration.name,
    input,
    {
      onToolsChanged: () => PubSub.publishUnsafe(changes, undefined),
      onResourcesChanged: () => opened?.forgetListing(),
      onResourceUpdated: (update) => {
        opened?.forgetDocument(update.uri);
        const entry = resources.get(update.uri);
        if (entry !== undefined) Effect.runSync(PubSub.publish(entry.updates, redactValue(update, redact)));
      },
      onClosed: () =>
        Deferred.doneUnsafe(
          closed,
          Effect.succeed(
            new McpConnectFailed({
              server: declaration.name,
              transport: declaration.transport,
              reason: 'the server closed its transport',
              stderr: stderr.tail === undefined ? undefined : (redact?.(stderr.tail) ?? stderr.tail),
            }),
          ),
        ),
    },
    options.roots,
  ).pipe(Effect.mapError((failure) => scrubbed(failure, redact)));
  const under: McpRequestOptions = {
    timeout,
    redact,
  };
  const maxCatalogBytes = declaration.maxCatalogBytes ?? MCP_DEFAULT_CATALOG_BYTES;
  const descriptors = yield* Effect.interruptible(
    Effect.andThen(mcpConnect(connection, under), listAll(connection, under, maxCatalogBytes)),
  ).pipe(
    Effect.mapError((failure) => scrubbed(withStderr(failure, stderr), redact)),
    Effect.onError(() => mcpClose(connection, timeout, redact)),
  );
  opened = makeMcpSession({
    server: declaration.name,
    descriptors,
    changes,
    closed,
    timeoutMs: timeout,
    maxCatalogBytes,
    connection,
    resources,
    subscriptions,
    options,
  });
  return opened;
});

export const openMcpSession = (
  declaration: McpServerDeclaration,
  options: McpSessionOptions = {},
): Effect.Effect<McpSession, McpSessionFailure, Scope.Scope> =>
  Effect.acquireRelease(acquire(declaration, options), (session) => session.close());
