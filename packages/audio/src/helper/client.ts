import { Clock, Deferred, Duration, Effect, Exit, Fiber, Layer, Scope, Semaphore } from 'effect';
import { AudioDevices, type Availability, type Capabilities } from '../port/devices.ts';
import { DeviceRefused } from '../port/refusal.ts';
import { HelperChannel } from './channel.ts';
import { playbackWindowMs } from './messages.ts';
import { capture, mute, play } from './resources.ts';
import { makeSession, type Session } from './session.ts';

export type ClientOptions = {
  readonly helloTimeout?: Duration.Input;
  readonly idle?: Duration.Input;
  readonly queueMs?: number;
  readonly bufferMs?: number;
};

export type Holder = {
  readonly hold: Effect.Effect<Session, DeviceRefused, Scope.Scope>;
  readonly queueMs: number;
  readonly bufferMs: number;
};

const tokenOf = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const makeHelperClient = Effect.fnUntraced(function* ({
  capabilities,
  options = {},
}: {
  readonly capabilities: Capabilities;
  readonly options?: ClientOptions;
}) {
  const channel = yield* HelperChannel;
  const clock = yield* Clock.Clock;
  const lock = yield* Semaphore.make(1);
  const helloTimeout = Duration.fromInputUnsafe(options.helloTimeout ?? Duration.seconds(10));
  const idle = Duration.fromInputUnsafe(options.idle ?? Duration.seconds(30));
  const queueMs = options.queueMs ?? playbackWindowMs;
  if (!(queueMs > 0 && queueMs <= playbackWindowMs)) {
    return yield* Effect.die(new RangeError(`queueMs ${queueMs} is outside the helper playback window of 1..${playbackWindowMs} ms`));
  }
  const bufferMs = options.bufferMs ?? 10_000;
  let standing: Session | undefined;
  let idler: Fiber.Fiber<void> | undefined;

  const connect = Effect.fnUntraced(function* (scope: Scope.Closeable): Effect.fn.Return<Session, DeviceRefused> {
    const token = tokenOf();
    const hello = Deferred.makeUnsafe<void, DeviceRefused>();
    const session = yield* Effect.gen(function* () {
      const socket = yield* channel
        .open(token)
        .pipe(Effect.mapError((absent) => new DeviceRefused({ code: 'unavailable', message: absent.reason, unblock: absent.unblock })));
      const writer = yield* socket.writer;
      const opened = makeSession({ scope, write: (bytes) => writer.write(bytes), clock, token, hello });
      yield* Effect.addFinalizer(() => Effect.sync(() => opened.lose()));
      yield* Effect.forkScoped(opened.run(socket));
      return opened;
    }).pipe(Scope.provide(scope));
    yield* Deferred.await(hello).pipe(
      Effect.timeoutOrElse({
        duration: helloTimeout,
        orElse: () =>
          Effect.fail(
            new DeviceRefused({
              code: 'unavailable',
              message: `the audio helper did not answer within ${Duration.format(helloTimeout)}`,
              unblock: ['open the host application once in a graphical session'],
            }),
          ),
      }),
    );
    return session;
  });

  const open = Effect.fnUntraced(function* (): Effect.fn.Return<Session, DeviceRefused> {
    const scope = yield* Scope.make();
    return yield* connect(scope).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
  });

  const attach = lock.withPermits(1)(
    Effect.gen(function* () {
      if (idler !== undefined) yield* Fiber.interrupt(idler);
      idler = undefined;
      const current = standing !== undefined && standing.live() ? standing : yield* open();
      standing = current;
      current.enter();
      return current;
    }),
  );

  const retire = (session: Session): Effect.Effect<void> =>
    Effect.sleep(idle).pipe(
      Effect.andThen(
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (session.held() > 0 || standing !== session) return;
            standing = undefined;
            idler = undefined;
            yield* Effect.exit(session.send({ type: 'quit' }));
            yield* Scope.close(session.scope, Exit.void);
          }),
        ),
      ),
    );

  const detach = (session: Session): Effect.Effect<void> =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (session.leave() > 0 || standing !== session) return;
        idler = yield* Effect.forkDetach(retire(session));
      }),
    );

  const hold = Effect.acquireRelease(attach, detach);

  const shutdown = lock.withPermits(1)(
    Effect.gen(function* () {
      if (idler !== undefined) yield* Fiber.interrupt(idler);
      idler = undefined;
      const session = standing;
      standing = undefined;
      if (session !== undefined) yield* Scope.close(session.scope, Exit.void);
    }),
  );

  yield* Effect.addFinalizer(() => shutdown);

  const holder: Holder = { hold, queueMs, bufferMs };

  return AudioDevices.of({
    capabilities,
    availability: Effect.scoped(hold).pipe(
      Effect.match({
        onSuccess: (): Availability => ({ _tag: 'present' }),
        onFailure: (refused): Availability => ({ _tag: 'absent', reason: refused.message, unblock: refused.unblock }),
      }),
    ),
    devices: Effect.scoped(Effect.flatMap(hold, (session) => session.inventory())),
    output: Effect.scoped(Effect.flatMap(hold, (session) => session.output())),
    capture: (request) => capture(holder, request),
    play: (format) => play(holder, format),
    mute: mute(holder),
  });
});

export const helperClientLayer = (
  capabilities: Capabilities,
  options: ClientOptions = {},
): Layer.Layer<AudioDevices, never, HelperChannel> => Layer.effect(AudioDevices, makeHelperClient({ capabilities, options }));
