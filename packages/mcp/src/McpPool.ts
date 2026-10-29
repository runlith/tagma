import { Cause, Clock, Deferred, Duration, Effect, Exit, Fiber, FiberMap, PubSub, Scope, Stream } from 'effect';
import { declare, type Held } from '@runlith/held/Held';
import { flight } from '@runlith/held/Flight';
import type { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import { type McpAppFailure, type McpAppTarget, mcpVisibleTo } from './mcpApps';
import {
  McpCallFailed,
  McpConnectFailed,
  type McpFailure,
  McpNeedsSignIn,
  McpNotConnected,
  McpResourceFailed,
  McpServerReplaced,
  McpToolUnoffered,
} from './McpFailure';
import { mcpDeclarationFingerprint } from './mcpDeclarationFingerprint';
import { McpRoots } from './McpRoots';
import { type McpServerDeclaration, mcpDeclarationsEqual } from './McpServerDeclaration';
import {
  type McpCallOptions,
  type McpSession,
  type McpSessionFailure,
  type McpSessionOptions,
  type McpToolDescriptor,
  openMcpSession,
} from './McpSession';
import type { McpSdkCallResult } from './sdk';

const ANSWERED_RECENTLY_MS = 10_000;

export type McpServerStatus = 'connecting' | 'connected' | 'needs-sign-in' | 'failed' | 'disabled';

export type McpServerState = {
  readonly name: string;
  readonly status: McpServerStatus;
  readonly tools: number;
  readonly failure?: McpFailure;
  readonly measuredAt: number;
  readonly identity: string;
};

export type McpPaletteEntry = {
  readonly declaration: McpServerDeclaration;
  readonly descriptors: readonly McpToolDescriptor[];
};

export type McpPalette = readonly McpPaletteEntry[];

export type McpReconcileLive = {
  readonly declaration: McpServerDeclaration;
  readonly status: McpServerStatus;
};

export type McpReconcileAction =
  | { readonly kind: 'start'; readonly declaration: McpServerDeclaration }
  | { readonly kind: 'disable'; readonly declaration: McpServerDeclaration }
  | { readonly kind: 'remove'; readonly name: string };

export function mcpReconcileActions(
  live: ReadonlyMap<string, McpReconcileLive>,
  declarations: readonly McpServerDeclaration[],
): readonly McpReconcileAction[] {
  const actions: McpReconcileAction[] = [];
  const declared = new Set(declarations.map((declaration) => declaration.name));
  for (const name of live.keys()) {
    if (!declared.has(name)) actions.push({ kind: 'remove', name });
  }
  for (const declaration of declarations) {
    const standing = live.get(declaration.name);
    if (!declaration.enabled) {
      if (standing === undefined || standing.status !== 'disabled') actions.push({ kind: 'disable', declaration });
      continue;
    }
    const settled =
      standing !== undefined &&
      (standing.status === 'connecting' || standing.status === 'connected' || standing.status === 'needs-sign-in');
    if (settled && mcpDeclarationsEqual(standing.declaration, declaration)) continue;
    actions.push({ kind: 'start', declaration });
  }
  return actions;
}

type Rebuild = {
  readonly key: string;
  joiners: number;
  readonly abandoned: Deferred.Deferred<void>;
};

type Silent = {
  readonly session: McpSession;
  readonly generation: number;
};

type Entry = {
  declaration: McpServerDeclaration;
  identity: string;
  status: McpServerStatus;
  generation: number;
  session: McpSession | undefined;
  sessionScope: Scope.Closeable | undefined;
  connecting: Fiber.Fiber<McpSession, McpSessionFailure> | undefined;
  awaited: boolean;
  failure: McpFailure | undefined;
  measuredAt: number;
};

export type McpPool = Effect.Success<ReturnType<typeof makeMcpPool>>;

const makeMcpPool = Effect.fnUntraced(function* (given: McpSessionOptions = {}) {
  const workspace = given.roots ?? new McpRoots();
  const options: McpSessionOptions = { ...given, roots: workspace };
  const scope = yield* Effect.scope;
  const connects = yield* FiberMap.make<string>();
  const flights = yield* Scope.fork(scope);
  const repairs = yield* flight<string, McpSession, McpFailure>({
    name: 'mcp-repair',
    owner: 'mcp',
    key: (key) => key,
    ceiling: Duration.minutes(15),
  }).pipe(Scope.provide(flights));
  const entries = new Map<string, Entry>();
  const rebuilds = new Map<string, Rebuild>();
  const pulses = yield* Effect.acquireRelease(PubSub.sliding<void>(1), PubSub.shutdown);
  const sessions = yield* Scope.fork(scope, 'parallel');
  const moved = PubSub.publish(pulses, undefined);
  const failed = Effect.fnUntraced(function* (entry: Entry, failure: McpFailure) {
    entry.status = failure._tag === 'McpNeedsSignIn' ? 'needs-sign-in' : 'failed';
    entry.failure = failure;
    entry.measuredAt = yield* Clock.currentTimeMillis;
    yield* moved;
  });
  const passes: Held<'pass'> = declare<'pass'>({
    name: 'mcp-reconcile',
    owner: 'mcp',
    rank: 211,
    key: (key) => key,
    concurrency: 1,
    threshold: Duration.seconds(5),
    ceilings: {
      hold: Duration.minutes(15),
      wait: Duration.minutes(15),
      leaves: 'the latest list stays unreconciled until the next reconcile',
    },
    external: 'none',
  });
  let latest: readonly McpServerDeclaration[] = [];
  let dirty = false;
  let generations = 0;
  let rebuildsStarted = 0;

  const abortEveryHandshake = (): void => {
    for (const entry of entries.values()) {
      const connecting = entry.connecting;
      entry.connecting = undefined;
      if (connecting === undefined) continue;
      connecting.interruptUnsafe();
      entry.status = 'failed';
    }
  };

  const reconcile = Effect.fn('McpPool.reconcile')((declarations: readonly McpServerDeclaration[]) =>
    Effect.suspend(() => {
      latest = declarations;
      dirty = true;
      return passes.hold('pass', passUntilClean());
    }),
  );

  const awaitHandshakes = Effect.fn('McpPool.awaitHandshakes')(function* () {
    const attempts: Fiber.Fiber<unknown, unknown>[] = [];
    for (const [name, entry] of [...entries]) {
      if (!entry.awaited) continue;
      const attempt = yield* FiberMap.get(connects, name);
      if (attempt._tag === 'Some') attempts.push(attempt.value);
    }
    yield* Fiber.awaitAll(attempts);
  });

  const awaitHandshake = Effect.fn('McpPool.awaitHandshake')(function* (name: string) {
    const attempt = yield* FiberMap.get(connects, name);
    if (attempt._tag === 'Some') yield* Fiber.await(attempt.value);
  });

  const paletteUnsafe = (): McpPalette => {
    const palette: McpPaletteEntry[] = [];
    for (const [, entry] of entries) {
      if (entry.status === 'connected' && entry.session !== undefined) {
        palette.push({
          declaration: entry.declaration,
          descriptors: entry.session.descriptors,
        });
      }
    }
    return palette;
  };

  const states = (): readonly McpServerState[] =>
    [...entries.values()].map((entry) => ({
      name: entry.declaration.name,
      status: entry.status,
      tools: entry.status === 'connected' ? (entry.session?.descriptors.length ?? 0) : 0,
      failure: entry.failure,
      measuredAt: entry.measuredAt,
      identity: entry.identity,
    }));

  const announce = Effect.fn('McpPool.announce')(function* () {
    for (const [name, entry] of entries) {
      const session = entry.session;
      if (session === undefined) continue;
      yield* Effect.forkIn(
        session.syncRoots().pipe(
          Effect.catchTags({
            McpCallFailed: (failure) => Effect.logWarning('An MCP server was not told of its changed roots', { server: name, failure }),
            McpTimedOut: (failure) => Effect.logWarning('An MCP server was not told of its changed roots', { server: name, failure }),
          }),
        ),
        scope,
      );
    }
  });

  const place = Effect.fn('McpPool.place')((paths: readonly string[]) =>
    Effect.suspend(() => (workspace.seed(paths) ? announce() : Effect.void)),
  );

  const call = Effect.fn('McpPool.call')(
    (server: string, tool: string, args: Readonly<Record<string, unknown>>, options: McpCallOptions = {}) =>
      Effect.andThen(
        Effect.suspend(() => (workspace.join(options.roots ?? []) ? announce() : Effect.void)),
        Effect.flatMap(live(server, tool, options), (session) => answering(server, session, session.call(tool, args, options), options)),
      ),
  );

  const appView = Effect.fn('McpPool.appView')((view: McpAppTarget, uri: string, tool: string | undefined, options: McpCallOptions = {}) =>
    Effect.flatMap(bound(view, 'resources/read', options), (session) =>
      answering(view.server, session, session.appDocument(uri, options), options).pipe(
        Effect.map((document) => {
          const descriptor = tool === undefined ? undefined : session.descriptors.find((candidate) => candidate.name === tool);
          return descriptor === undefined ? document : { ...document, tool: descriptor };
        }),
      ),
    ),
  );

  const appCall = Effect.fn('McpPool.appCall')(function* (
    view: McpAppTarget,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    options: McpCallOptions = {},
  ): Effect.fn.Return<McpSdkCallResult, McpAppFailure> {
    const session = yield* bound(view, tool, options);
    const descriptor = session.descriptors.find((candidate) => candidate.name === tool);
    if (descriptor === undefined || !mcpVisibleTo(descriptor, 'app')) return yield* new McpToolUnoffered({ server: view.server, tool });
    return yield* answering(view.server, session, session.call(tool, args, options), options);
  });

  const appRead = Effect.fn('McpPool.appRead')((view: McpAppTarget, uri: string, options: McpCallOptions = {}) =>
    Effect.flatMap(bound(view, 'resources/read', options), (session) =>
      answering(view.server, session, session.readResource(uri, options), options),
    ),
  );

  const appSubscribe = Effect.fn('McpPool.appSubscribe')((view: McpAppTarget, uri: string, options: McpCallOptions = {}) =>
    Effect.flatMap(bound(view, 'resources/subscribe', options), (session) => session.subscribeResource(uri, options)),
  );

  const bound = (view: McpAppTarget, tool: string, options: McpCallOptions): Effect.Effect<McpSession, McpAppFailure> =>
    Effect.flatMap(live(view.server, tool, options), (session) =>
      entries.get(view.server)?.identity === view.identity
        ? Effect.succeed(session)
        : Effect.fail(new McpServerReplaced({ server: view.server })),
    );

  const live = Effect.fnUntraced(function* (
    server: string,
    tool: string,
    options: McpCallOptions,
  ): Effect.fn.Return<McpSession, McpFailure | HoldStalled | ReentrantCall> {
    const standing = entries.get(server);
    const held = standing?.session;
    const silent: Silent | undefined =
      standing === undefined || held === undefined ? undefined : { session: held, generation: standing.generation };
    if (held !== undefined && held.answeredWithin(ANSWERED_RECENTLY_MS, yield* Clock.currentTimeMillis)) return held;
    if (held !== undefined && (yield* stillAnswers(held, options))._tag === 'answering') return held;
    return yield* rebuilt(server, tool, silent);
  });

  const rebuilt = Effect.fn('McpPool.rebuilt')((server: string, tool: string, silent: Silent | undefined) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const standing = rebuilds.get(server);
        if (standing !== undefined) {
          standing.joiners += 1;
          return standing;
        }
        rebuildsStarted += 1;
        const rebuild: Rebuild = {
          key: `${server}#${rebuildsStarted}`,
          joiners: 1,
          abandoned: Deferred.makeUnsafe<void>(),
        };
        rebuilds.set(server, rebuild);
        return rebuild;
      }),
      (rebuild) =>
        repairs.join(
          rebuild.key,
          Effect.raceFirst(
            repair(server, tool, silent),
            Effect.andThen(
              Deferred.await(rebuild.abandoned),
              Effect.fail(
                new McpCallFailed({
                  server,
                  tool,
                  reason: `every caller left the ${server} server's repair`,
                }),
              ),
            ),
          ),
        ),
      (rebuild) =>
        Effect.sync(() => {
          rebuild.joiners -= 1;
          if (rebuild.joiners > 0) return;
          if (rebuilds.get(server) === rebuild) rebuilds.delete(server);
          Deferred.doneUnsafe(rebuild.abandoned, Effect.void);
        }),
    ),
  );

  const answering = <A, E extends McpFailure | McpResourceFailed>(
    server: string,
    session: McpSession,
    request: Effect.Effect<A, E>,
    options: McpCallOptions,
  ): Effect.Effect<A, E> =>
    request.pipe(
      Effect.tapError((refused) => {
        const dropped = Effect.fnUntraced(function* (failure: McpFailure) {
          const entry = entries.get(server);
          if (entry === undefined || entry.session !== session) return;
          yield* failed(entry, failure);
          yield* teardown(server);
        });
        const asked = refused instanceof McpNeedsSignIn ? refused : refused instanceof McpResourceFailed ? refused.signIn : undefined;
        return asked !== undefined
          ? dropped(asked)
          : Effect.matchEffect(session.ping(), { onSuccess: () => Effect.void, onFailure: dropped });
      }),
    );

  const stillAnswers = (session: McpSession, options: McpCallOptions) =>
    Effect.match(session.ping(options), {
      onSuccess: () => ({ _tag: 'answering' as const }),
      onFailure: (failure) => ({ _tag: 'silent' as const, failure }),
    });

  const repair = Effect.fn('McpPool.repair')(function* (
    server: string,
    tool: string,
    silent: Silent | undefined,
  ): Effect.fn.Return<McpSession, McpFailure> {
    const standing = entries.get(server);
    if (standing === undefined) return yield* new McpNotConnected({ server, state: 'undeclared' });
    if (standing.status === 'disabled') return yield* new McpNotConnected({ server, state: 'disabled' });
    const probed = silent !== undefined && silent.session === standing.session && silent.generation === standing.generation;
    if (standing.session !== undefined && !probed && (yield* stillAnswers(standing.session, {}))._tag === 'answering') {
      return standing.session;
    }
    if (standing.status === 'connecting') {
      const attempt = yield* FiberMap.get(connects, server);
      if (attempt._tag === 'Some') {
        yield* Fiber.await(attempt.value);
      }
      const after = entries.get(server);
      if (after?.session !== undefined) return after.session;
      if (after?.failure !== undefined) return yield* Effect.fail(after.failure);
      return yield* new McpNotConnected({
        server,
        state: after?.status ?? 'undeclared',
      });
    }
    yield* teardown(server);
    const entry = entries.get(server);
    if (entry === undefined) return yield* new McpNotConnected({ server, state: 'undeclared' });
    entry.status = 'failed';
    entry.measuredAt = yield* Clock.currentTimeMillis;
    const generation = entry.generation;
    const opened = yield* acquire(entry.declaration, generation).pipe(
      Effect.tapError((failure) => (entry.generation === generation ? failed(entry, failure) : Effect.void)),
    );
    if (opened !== undefined) return opened;
    const newer = entries.get(server);
    if (newer?.session !== undefined) return newer.session;
    return yield* new McpNotConnected({
      server,
      state: newer?.status ?? 'undeclared',
    });
  });

  const acquire = Effect.fn('McpPool.acquire')(function* (
    declaration: McpServerDeclaration,
    generation: number,
  ): Effect.fn.Return<McpSession | undefined, McpSessionFailure> {
    const sessionScope = yield* Scope.fork(sessions);
    let kept = false;
    const handshake = yield* Effect.forkChild(openMcpSession(declaration, options).pipe(Scope.provide(sessionScope)), {
      startImmediately: true,
    });
    const starting = entries.get(declaration.name);
    if (starting !== undefined && starting.generation === generation) starting.connecting = handshake;
    return yield* Effect.gen(function* () {
      const shaken = yield* Fiber.await(handshake);
      if (Exit.isFailure(shaken)) {
        return yield* Cause.hasInterruptsOnly(shaken.cause)
          ? Effect.fail(
              new McpConnectFailed({
                server: declaration.name,
                transport: declaration.transport,
                reason: `the ${declaration.name} server was torn down before its handshake ended`,
              }),
            )
          : Effect.failCause(shaken.cause);
      }
      const session = shaken.value;
      const now = yield* Clock.currentTimeMillis;
      const entry = entries.get(declaration.name);
      if (entry === undefined || entry.generation !== generation) return undefined;
      entry.session = session;
      entry.sessionScope = sessionScope;
      entry.status = 'connected';
      entry.failure = undefined;
      entry.measuredAt = now;
      kept = true;
      yield* moved;
      yield* Effect.forkIn(watchChanges(declaration.name, session, generation), sessionScope);
      yield* Effect.forkIn(watchClosed(declaration.name, session, generation), sessionScope);
      return session;
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => {
          const entry = entries.get(declaration.name);
          if (entry?.connecting === handshake) entry.connecting = undefined;
          return kept ? Effect.void : Scope.close(sessionScope, Exit.void);
        }),
      ),
    );
  });

  const passUntilClean = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      dirty = false;
      return pass(latest).pipe(Effect.andThen(Effect.suspend(() => (dirty ? passUntilClean() : Effect.void))));
    });

  const pass = Effect.fn('McpPool.pass')(function* (declarations: readonly McpServerDeclaration[]): Effect.fn.Return<void> {
    const live = new Map<string, McpReconcileLive>();
    for (const [name, entry] of entries) live.set(name, { declaration: entry.declaration, status: entry.status });
    const actions = mcpReconcileActions(live, declarations);
    for (const action of actions) {
      switch (action.kind) {
        case 'remove': {
          yield* teardown(action.name);
          entries.delete(action.name);
          break;
        }
        case 'disable': {
          yield* teardown(action.declaration.name);
          const entry = entryOf(action.declaration);
          entry.status = 'disabled';
          entry.failure = undefined;
          entry.measuredAt = yield* Clock.currentTimeMillis;
          break;
        }
        case 'start': {
          const before = entries.get(action.declaration.name);
          const retried = before?.status === 'failed' && mcpDeclarationsEqual(before.declaration, action.declaration);
          yield* teardown(action.declaration.name);
          yield* start(entryOf(action.declaration), !retried);
          break;
        }
      }
    }
    if (actions.length > 0) yield* moved;
  });

  const start = Effect.fnUntraced(function* (entry: Entry, awaited: boolean) {
    entry.awaited = awaited;
    entry.status = 'connecting';
    entry.failure = undefined;
    entry.measuredAt = yield* Clock.currentTimeMillis;
    return yield* FiberMap.run(connects, entry.declaration.name)(connect(entry.declaration, entry.generation));
  });

  const reconnect = Effect.fn('McpPool.reconnect')(function* (
    name: string,
  ): Effect.fn.Return<McpServerStatus | undefined, HoldStalled | HoldCut> {
    const attempt = yield* passes.hold(
      'pass',
      Effect.suspend(() => {
        const entry = entries.get(name);
        if (entry === undefined || entry.status === 'disabled') return Effect.succeed(undefined);
        return teardown(name).pipe(
          Effect.andThen(start(entry, true)),
          Effect.tap(() => moved),
        );
      }),
    );
    if (attempt !== undefined) yield* Fiber.await(attempt);
    return entries.get(name)?.status;
  });

  const entryOf = (declaration: McpServerDeclaration): Entry => {
    const standing = entries.get(declaration.name);
    if (standing !== undefined) {
      standing.declaration = declaration;
      standing.identity = mcpDeclarationFingerprint(declaration);
      return standing;
    }
    const entry: Entry = {
      declaration,
      identity: mcpDeclarationFingerprint(declaration),
      status: 'disabled',
      generation: nextGeneration(),
      session: undefined,
      sessionScope: undefined,
      connecting: undefined,
      awaited: true,
      failure: undefined,
      measuredAt: 0,
    };
    entries.set(declaration.name, entry);
    return entry;
  };

  const nextGeneration = (): number => {
    generations += 1;
    return generations;
  };

  const teardown = Effect.fn('McpPool.teardown')(function* (name: string): Effect.fn.Return<void> {
    const entry = entries.get(name);
    if (entry === undefined) return;
    entry.generation = nextGeneration();
    const sessionScope = entry.sessionScope;
    const connecting = entry.connecting;
    entry.session = undefined;
    entry.sessionScope = undefined;
    entry.connecting = undefined;
    connecting?.interruptUnsafe();
    const attempt = yield* FiberMap.get(connects, name);
    if (attempt._tag === 'Some') attempt.value.interruptUnsafe();
    if (sessionScope !== undefined) yield* Effect.forkIn(Scope.close(sessionScope, Exit.void), scope);
  });

  const connect = Effect.fn('McpPool.connect')((declaration: McpServerDeclaration, generation: number) =>
    Effect.matchEffect(acquire(declaration, generation), {
      onSuccess: () => Effect.void,
      onFailure: (failure) => {
        const entry = entries.get(declaration.name);
        return entry === undefined || entry.generation !== generation ? Effect.void : failed(entry, failure);
      },
    }),
  );

  const watchChanges = Effect.fnUntraced(function* (name: string, session: McpSession, generation: number) {
    const changes = yield* PubSub.subscribe(session.changes);
    while (true) {
      yield* PubSub.take(changes);
      yield* PubSub.takeUpTo(changes, Number.MAX_SAFE_INTEGER);
      yield* refresh(name, session, generation);
    }
  }, Effect.scoped);

  const watchClosed = Effect.fnUntraced(function* (name: string, session: McpSession, generation: number): Effect.fn.Return<void> {
    const failure = yield* Deferred.await(session.closed);
    const entry = entries.get(name);
    if (entry === undefined || entry.generation !== generation || entry.session !== session) return;
    yield* failed(entry, failure);
    yield* teardown(name);
  });

  const refresh = Effect.fn('McpPool.refresh')(function* (name: string, session: McpSession, generation: number): Effect.fn.Return<void> {
    if (standing(name, session, generation) === undefined) return;
    yield* Effect.matchEffect(session.refresh(), {
      onSuccess: () => moved,
      onFailure: Effect.fnUntraced(function* (failure) {
        const entry = standing(name, session, generation);
        if (entry === undefined) return;
        yield* teardown(name);
        yield* failed(entry, failure);
      }),
    });
  });

  const standing = (name: string, session: McpSession, generation: number): Entry | undefined => {
    const entry = entries.get(name);
    return entry !== undefined && entry.generation === generation && entry.session === session ? entry : undefined;
  };

  yield* Effect.addFinalizer(() => Effect.sync(abortEveryHandshake));
  return {
    reconcile,
    reconnect,
    awaitHandshakes,
    awaitHandshake,
    paletteUnsafe,
    states,
    changes: Stream.fromPubSub(pulses),
    place,
    call,
    appView,
    appCall,
    appRead,
    appSubscribe,
  };
});
export const McpPool = { make: makeMcpPool };
