import type { graphChangeSchema, graphFrameSchema } from '@tagma/server/graph/contract/wire/feed';
import { liveSerialization } from '@tagma/server/platform/contract/wire/live';
import type { Words } from '@tagma/server/platform/contract/wire/refusal';
import { DEVICE_REVOKED_CLOSE } from '@tagma/server/remote/contract/wire/access';
import { TAGMA_SOCKET_PATH } from '@tagma/server/socket/rpc';
import type { WireModule } from '@tagma/server/platform/contract/wire/manifest';
import { liveGroupFrom, type LiveGroup, type LiveRpcs } from './liveGroup.js';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { wireEntries, WireEntryKinds } from './WireEntryKinds.js';
import { WireCatalog } from './WireCatalog.js';
import { Platform, type PlatformSocket } from '@runlith/layer/Platform';
import type { Point } from '@runlith/layer/Point';
import { Scope as AppScope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Cause, Context, Data, Deferred, Effect, Exit, type Fiber, FiberSet, Layer, Scope, Stream } from 'effect';
import { RpcClient, RpcClientError } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { Refusal, refusalOf } from './refusal.js';
import { causeText, closeFailure, failureFromCause, failureOf, type LiveError } from './liveFailure.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'paused' | 'refused';

export type LiveFailure =
  | {
      readonly kind: 'connection';
      readonly message: string;
      readonly code?: number;
      readonly reason?: string;
      readonly wasClean?: boolean;
    }
  | {
      readonly kind: 'subscription';
      readonly message: string;
      readonly code?: string;
      readonly unblock?: readonly string[];
      readonly words?: Words;
    };

export type ConnectionFailure = Extract<LiveFailure, { readonly kind: 'connection' }>;

export type SubscriptionFailure = Extract<LiveFailure, { readonly kind: 'subscription' }>;

class LivePaused extends Data.TaggedError('LivePaused') {
  override get message(): string {
    return 'The live connection is let go while the browser keeps this page cached. It opens again when you return.';
  }
}

class LiveRefused extends Data.TaggedError('LiveRefused') {
  override get message(): string {
    return 'The server refused this device, so the live connection stays shut until it is paired again.';
  }
}

class LiveConnectionLost extends Data.TaggedError('LiveConnectionLost')<{ readonly failure: ConnectionFailure }> {
  override get message(): string {
    return this.failure.message;
  }
}

type LiveGone = LivePaused | LiveRefused | LiveConnectionLost;

export class CallFailed extends Data.TaggedError('CallFailed')<{ readonly refusal: Refusal; readonly sent: boolean }> {
  override get message(): string {
    return this.refusal.message;
  }
}

type LiveFork = <XA, XE extends LiveGone>(effect: Effect.Effect<XA, XE>) => Fiber.Fiber<XA, XE>;

type Ahead = {
  start(client: ServerClient): void;
  fail(gone: LiveGone): void;
};

export type GraphFrame = typeof graphFrameSchema.Type;
export type GraphChange = typeof graphChangeSchema.Type;

export type ServerClient = RpcClient.RpcClient<LiveRpcs, RpcClientError.RpcClientError>;

class LiveClient extends Context.Service<LiveClient, ServerClient>()('tagma/app/LiveClient') {}

type LiveStream = {
  start(client: ServerClient): void;
  stop(failure?: ConnectionFailure): void;
  fail(failure: LiveFailure): void;
  readonly resume: LiveResume;
};

export type LiveResume = 'bytes' | 'frame' | 'feed';

export type LiveEnding = 'again' | 'once';

export type LiveChannel = 'shared' | 'separate';

const RESUME_ORDER: readonly LiveResume[] = ['bytes', 'frame', 'feed'];

export class LiveConnection {
  private currentStatus: LiveStatus = 'idle';
  private readonly statusListeners = new Set<(status: LiveStatus) => void>();
  private readonly failureListeners = new Set<(failure: ConnectionFailure) => void>();
  private readonly streams = new Set<LiveStream>();
  private readonly inflight = new Set<Deferred.Deferred<never, LiveConnectionLost>>();
  private readonly ahead = new Set<Ahead>();

  private generation = 0;
  private scope: Scope.Closeable | null = null;
  private connection: Deferred.Deferred<ServerClient, LiveConnectionLost> | null = null;
  private socketOpen: Deferred.Deferred<void, LiveConnectionLost> | null = null;
  private paused = false;
  private refused = false;
  private readonly group: () => LiveGroup;

  private constructor(
    private readonly life: Scope.Scope,
    private readonly fork: LiveFork,
    private readonly socket: PlatformSocket,
    private readonly origin: ServerOrigin,
    private readonly catalog: Point<WireModule>,
    private readonly entries: ThreadEntryReader,
  ) {
    this.group = liveGroupFrom(catalog);
  }

  static make(
    socket: PlatformSocket,
    origin: ServerOrigin,
    catalog: Point<WireModule>,
    entries: ThreadEntryReader = wireEntries(undefined),
  ): Effect.Effect<LiveConnection, never, Scope.Scope> {
    return Effect.flatMap(Scope.Scope, (life) =>
      Effect.map(
        FiberSet.makeRuntime<never, unknown, LiveGone>(),
        (fork) => new LiveConnection(life, fork, socket, origin, catalog, entries),
      ),
    );
  }

  get status(): LiveStatus {
    return this.currentStatus;
  }

  subscribeStatus(listener: (status: LiveStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeFailure(listener: (failure: ConnectionFailure) => void): () => void {
    this.failureListeners.add(listener);
    return () => {
      this.failureListeners.delete(listener);
    };
  }

  reopen(): void {
    if (this.paused || this.refused) return;
    if (this.currentStatus === 'open') return;
    if (this.streams.size === 0) return;
    this.fork(Effect.ignore(this.connected()));
  }

  reopening(): Fiber.Fiber<void, never> {
    const attempt: Effect.Effect<void> = Effect.suspend(() => {
      if (this.paused || this.refused || this.streams.size === 0 || this.connection !== null) return Effect.void;
      return Effect.flatMap(
        Effect.zip(Effect.exit(this.connected()), Effect.sleep(LiveConnection.CONNECT_DEADLINE_MS), { concurrent: true }),
        ([answered]) => {
          if (Exit.isSuccess(answered)) return Effect.void;
          if (Cause.hasInterruptsOnly(answered.cause)) return Effect.void;
          return attempt;
        },
      );
    });
    return this.fork(attempt);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.letGo('The live connection was let go when the browser cached this page.');
    this.setStatus('paused');
  }

  refuse(): void {
    if (this.refused) return;
    this.refused = true;
    this.letGo('The server refused this device; the live connection stays shut.');
    this.setStatus('refused');
  }

  renew(): void {
    if (this.paused || this.currentStatus !== 'open') return;
    this.letGo('The live connection was renewed when the page came back from the background.');
    this.setStatus('idle');
    this.reopen();
  }

  private letGo(message: string): void {
    this.generation += 1;
    const scope = this.scope;
    this.scope = null;
    this.connection = null;
    const lost = new LiveConnectionLost({ failure: { kind: 'connection', message } });
    this.unopened(lost);
    for (const waiting of this.inflight) Deferred.doneUnsafe(waiting, Effect.fail(lost));
    this.inflight.clear();
    for (const stream of this.streams) stream.stop(lost.failure);
    if (scope) this.fork(Scope.close(scope, Exit.void));
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.refused) return;
    this.setStatus('idle');
    if (this.streams.size === 0) return;
    this.fork(Effect.ignore(this.connected()));
  }

  attach(): () => void {
    let retry: Fiber.Fiber<void, never> | null = null;
    const stopRetrying = () => {
      retry?.interruptUnsafe();
      retry = null;
    };
    const startRetrying = () => {
      if (retry !== null) return;
      const started = this.reopening();
      retry = started;
      started.addObserver(() => {
        if (retry === started) retry = null;
      });
    };
    const reopen = () => this.reopen();
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > LiveConnection.AWAY_MS) this.renew();
      else this.reopen();
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        stopRetrying();
        this.pause();
      }
    };
    const onPageShow = () => {
      this.resume();
      this.reopen();
    };
    const offStatus = this.subscribeStatus((status) => {
      if (status === 'closed') {
        startRetrying();
        return;
      }
      if (status === 'open' || status === 'paused') stopRetrying();
    });
    window.addEventListener('focus', reopen);
    window.addEventListener('online', reopen);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', reopen);
    document.addEventListener('keydown', reopen);
    return () => {
      offStatus();
      stopRetrying();
      window.removeEventListener('focus', reopen);
      window.removeEventListener('online', reopen);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', reopen);
      document.removeEventListener('keydown', reopen);
    };
  }

  call<A>(work: (client: ServerClient) => Effect.Effect<A, LiveError>): Promise<A> {
    return Effect.runPromise(Effect.mapError(this.answered(work), callRefusal));
  }

  attempt<A>(work: (client: ServerClient) => Effect.Effect<A, LiveError>): Effect.Effect<A, CallFailed> {
    return Effect.flatMap(
      Effect.mapError(this.connected(), (gone) => new CallFailed({ refusal: callRefusal(gone), sent: false })),
      (client) => Effect.mapError(this.flight(client, work), sentFailure),
    );
  }

  attemptFirst<A>(work: (client: ServerClient) => Effect.Effect<A, LiveError>): Effect.Effect<A, CallFailed> {
    return Effect.suspend(() => {
      if (this.currentStatus === 'open' && this.connection !== null) return this.attempt(work);
      const answer = Deferred.makeUnsafe<A, CallFailed>();
      const waiting: Ahead = {
        start: (client) => {
          this.fork(Deferred.into(Effect.mapError(this.flight(client, work), sentFailure), answer));
        },
        fail: (gone) => {
          Deferred.doneUnsafe(answer, Effect.fail(new CallFailed({ refusal: callRefusal(gone), sent: false })));
        },
      };
      this.ahead.add(waiting);
      const failed = (gone: LiveGone) =>
        Effect.sync(() => {
          if (this.ahead.delete(waiting)) waiting.fail(gone);
        });
      this.fork(
        Effect.catchTags(Effect.asVoid(this.connected()), {
          LivePaused: failed,
          LiveRefused: failed,
          LiveConnectionLost: failed,
        }),
      );
      return Effect.onInterrupt(Deferred.await(answer), () =>
        Effect.sync(() => {
          this.ahead.delete(waiting);
        }),
      );
    });
  }

  private answered<A>(work: (client: ServerClient) => Effect.Effect<A, LiveError>): Effect.Effect<A, LiveError | LiveGone> {
    return Effect.flatMap(this.connected(), (client) => this.flight(client, work));
  }

  private flight<A>(
    client: ServerClient,
    work: (client: ServerClient) => Effect.Effect<A, LiveError>,
  ): Effect.Effect<A, LiveError | LiveGone> {
    return Effect.suspend(() => {
      const generation = this.generation;
      const dropped = Deferred.makeUnsafe<never, LiveConnectionLost>();
      this.inflight.add(dropped);
      return work(client).pipe(
        Effect.provideService(ThreadEntryKinds, this.entries),
        Effect.tapCause((cause) =>
          Effect.sync(() => {
            const failure = failureFromCause(cause);
            if (failure.kind === 'connection') this.drop(failure, generation);
          }),
        ),
        Effect.raceFirst(Deferred.await(dropped)),
        Effect.ensuring(
          Effect.sync(() => {
            this.inflight.delete(dropped);
          }),
        ),
      );
    });
  }

  hold<A>(
    open: (client: ServerClient) => Stream.Stream<A, LiveError>,
    onItem: (item: A) => void | Promise<void>,
    onFailure: (failure: LiveFailure) => void,
    resume: LiveResume = 'feed',
    ending: LiveEnding = 'again',
    channel: LiveChannel = 'shared',
  ): { unsubscribe: () => void } {
    if (channel === 'separate') return this.separate(open, onItem, onFailure, resume, ending);
    let fiber: Fiber.Fiber<void, never> | null = null;
    let spent = false;
    let running = false;
    let startedOn: ServerClient | null = null;
    const attempt = (client: ServerClient): Effect.Effect<void> =>
      Effect.suspend(() => {
        return Stream.runForEach(open(client), (item) =>
          Effect.suspend(() => {
            const settled = onItem(item);
            return settled === undefined ? Effect.void : Effect.promise(() => settled);
          }),
        ).pipe(
          Effect.provideService(ThreadEntryKinds, this.entries),
          Effect.exit,
          Effect.flatMap((exit) =>
            Effect.suspend(() => {
              if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return Effect.void;
              if (startedOn !== client) return Effect.void;
              running = false;
              if (Exit.isFailure(exit)) {
                const failure = failureFromCause(exit.cause);
                console.error('[tagma] live subscription ended:', failure.message, exit.cause);
                if (failure.kind === 'connection') {
                  this.drop(failure);
                  return Effect.void;
                }
                onFailure(failure);
                return Effect.void;
              }
              if (ending === 'once') return Effect.void;
              return Effect.andThen(Effect.sleep(LiveConnection.FEED_REOPEN_MS), attempt(client));
            }),
          ),
        );
      });
    const stream: LiveStream = {
      start: (client) => {
        if (startedOn === client || (ending === 'once' && spent)) return;
        startedOn = client;
        spent = true;
        running = true;
        fiber?.interruptUnsafe();
        fiber = this.fork(attempt(client));
      },
      stop: (failure) => {
        const interrupted = running;
        running = false;
        startedOn = null;
        fiber?.interruptUnsafe();
        fiber = null;
        if (interrupted && ending === 'once' && failure !== undefined) onFailure(failure);
      },
      fail: onFailure,
      resume,
    };
    this.streams.add(stream);
    this.fork(
      this.connected().pipe(
        Effect.flatMap((client) =>
          Effect.sync(() => {
            if (this.streams.has(stream)) stream.start(client);
          }),
        ),
        Effect.ignore,
      ),
    );
    return {
      unsubscribe: () => {
        this.streams.delete(stream);
        stream.stop();
      },
    };
  }

  private separate<A>(
    open: (client: ServerClient) => Stream.Stream<A, LiveError>,
    onItem: (item: A) => void | Promise<void>,
    onFailure: (failure: LiveFailure) => void,
    resume: LiveResume,
    ending: LiveEnding,
  ): { unsubscribe: () => void } {
    const scope = Scope.forkUnsafe(this.life);
    const connection = new LiveConnection(scope, this.fork, this.socket, this.origin, this.catalog, this.entries);
    const detach = connection.attach();
    Effect.runSync(Scope.addFinalizer(scope, Effect.sync(detach)));
    const held = connection.hold(open, onItem, onFailure, resume, ending);
    let stopped = false;
    return {
      unsubscribe: () => {
        if (stopped) return;
        stopped = true;
        held.unsubscribe();
        this.fork(Scope.close(scope, Exit.void));
      },
    };
  }

  private static readonly FEED_REOPEN_MS = 1000;

  private static readonly CONNECT_DEADLINE_MS = 10_000;

  //! Two periods of the socket protocol's 5 s pinger, which offers no ping on demand: away longer, the OS may have killed the socket.
  private static readonly AWAY_MS = 10_000;

  private connected(): Effect.Effect<ServerClient, LiveGone> {
    return Effect.suspend((): Effect.Effect<ServerClient, LiveGone> => {
      const held = this.connection;
      if (held) return Deferred.await(held);
      if (this.refused) return Effect.fail(new LiveRefused());
      if (this.paused) return Effect.fail(new LivePaused());
      const opening = Deferred.makeUnsafe<ServerClient, LiveConnectionLost>();
      this.connection = opening;
      this.fork(Deferred.into(this.open(), opening));
      return Deferred.await(opening);
    });
  }

  private open(): Effect.Effect<ServerClient, LiveConnectionLost> {
    return Effect.suspend(() => {
      this.setStatus('connecting');
      const generation = ++this.generation;
      const opened = Deferred.makeUnsafe<void, LiveConnectionLost>();
      this.socketOpen = opened;
      return Scope.fork(this.life).pipe(
        Effect.flatMap((scope) => {
          this.scope = scope;
          return Scope.provide(
            Layer.build(Layer.effect(LiveClient)(RpcClient.make(this.group())).pipe(Layer.provide(this.wire(generation, opened)))),
            scope,
          );
        }),
        Effect.map((context) => Context.getUnsafe(context, LiveClient)),
        Effect.tap(() => Deferred.await(opened)),
        Effect.timeout(LiveConnection.CONNECT_DEADLINE_MS),
        Effect.tap((client) =>
          Effect.sync(() => {
            if (this.socketOpen === opened) this.socketOpen = null;
            const ahead = [...this.ahead];
            this.ahead.clear();
            for (const first of ahead) first.start(client);
            for (const stream of this.held()) stream.start(client);
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.suspend(() => {
            const failure: ConnectionFailure = {
              kind: 'connection',
              message: `The live connection to the Tagma server did not open: ${causeText(cause)}`,
            };
            this.drop(failure, generation);
            return Effect.fail(new LiveConnectionLost({ failure }));
          }),
        ),
      );
    });
  }

  private wire(generation: number, opened: Deferred.Deferred<void, LiveConnectionLost>): Layer.Layer<RpcClient.Protocol> {
    const socket = Layer.succeed(Socket.WebSocketConstructor)((address, options) => {
      const live = this.socket(address, typeof options === 'string' || Array.isArray(options) ? options : undefined);
      live.addEventListener('close', (event) => this.drop(closeFailure(event), generation), { once: true });
      live.addEventListener(
        'error',
        (event) => {
          const failure: ConnectionFailure = { kind: 'connection', message: causeText(Cause.fail(event)) };
          Deferred.doneUnsafe(opened, Effect.fail(new LiveConnectionLost({ failure })));
        },
        { once: true },
      );
      return live;
    });
    return RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(this.origin.socket(TAGMA_SOCKET_PATH))),
      Layer.provide([liveSerialization, socket]),
      Layer.provide(
        Layer.succeed(RpcClient.ConnectionHooks)({
          onConnect: Effect.sync(() => {
            if (generation !== this.generation) return;
            this.setStatus('open');
            Deferred.doneUnsafe(opened, Effect.void);
          }),
          onDisconnect: Effect.void,
        }),
      ),
    );
  }

  private drop(failure: ConnectionFailure, generation = this.generation): void {
    if (generation !== this.generation || (this.currentStatus === 'closed' && !this.scope && !this.connection)) return;
    console.error('[tagma] live connection dropped', failure);
    const scope = this.scope;
    this.scope = null;
    this.connection = null;
    const lost = new LiveConnectionLost({ failure });
    this.unopened(lost);
    for (const waiting of this.inflight) Deferred.doneUnsafe(waiting, Effect.fail(lost));
    this.inflight.clear();
    for (const stream of this.streams) {
      stream.stop();
      stream.fail(failure);
    }
    for (const listener of this.failureListeners) {
      try {
        listener(failure);
      } catch (error) {
        console.error('[tagma] live failure listener failed', error);
      }
    }
    if (scope) this.fork(Scope.close(scope, Exit.void));
    if (failure.code === DEVICE_REVOKED_CLOSE) this.refused = true;
    this.setStatus(this.refused ? 'refused' : 'closed');
  }

  private unopened(lost: LiveConnectionLost): void {
    const opened = this.socketOpen;
    this.socketOpen = null;
    if (opened) Deferred.doneUnsafe(opened, Effect.fail(lost));
  }

  private held(): readonly LiveStream[] {
    const streams = [...this.streams];
    return streams.sort((a, b) => RESUME_ORDER.indexOf(a.resume) - RESUME_ORDER.indexOf(b.resume));
  }

  private setStatus(status: LiveStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.error('[tagma] live status listener failed', error);
      }
    }
  }
}

function callRefusal(error: LiveError | LiveGone): Refusal {
  if (error instanceof LivePaused || error instanceof LiveRefused || error instanceof LiveConnectionLost)
    return transportRefusal(error.message, error);
  const failure = error instanceof RpcClientError.RpcClientError ? failureOf(error) : null;
  return failure?.kind === 'connection' ? transportRefusal(failure.message, error) : refusalOf(error);
}

function sentFailure(error: LiveError | LiveGone): CallFailed {
  return new CallFailed({ refusal: callRefusal(error), sent: true });
}

function transportRefusal(reason: string, cause: unknown): Refusal {
  return new Refusal({ gate: false, code: 'transport', reason, unblock: [], cause });
}

export class Live extends Service<LiveConnection>()('Live', { tier: 'app' }) {
  static *make() {
    const app = yield* AppScope;
    const platform = yield* Platform;
    const origin = yield* ServerOrigin;
    const fibers = Scope.makeUnsafe();
    const catalog = yield* WireCatalog;
    const kinds = yield* WireEntryKinds.optional();
    const live = Effect.runSync(Scope.provide(LiveConnection.make(platform.socket, origin, catalog, wireEntries(kinds)), fibers));
    app.defer(live.attach());
    app.defer(() => Effect.runPromise(Scope.close(fibers, Exit.void)));
    return live;
  }
}
