import { fileURLToPath } from 'node:url';
import { type Adapter, type Capability, EngineLost, Judgement, Located } from '@runlith/navigation/adapter';
import { type Checkout, CheckoutRefused, type Launch, Launcher, type Process, type Served, type Touch } from '@runlith/navigation/engine';
import { classify, type Envelope, frame } from '@runlith/ndjson-rpc/envelope';
import { type Cause, Deferred, Duration, Effect, Fiber, Layer, Queue, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { tracked } from './engine/checkout';
import { memoryOf } from './memory';
import { type Asked, type Asking, Drifted, METHODS, Refused, Standing } from './wire';

export const ENGINE = fileURLToPath(new URL('./engineProcess.ts', import.meta.url));

export const CAPABILITY: Capability = {
  language: 'typescript',
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  manifests: ['tsconfig.json', 'jsconfig.json', 'package.json', 'bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
  asks: ['definition', 'uses'],
};

export type Engine = { readonly runtime: string; readonly entry: string; readonly compiler: string | null };

type Touched = { readonly seq: number; paths: readonly string[]; known: boolean };

type Lease = { readonly revision: string; open: boolean };

type Seat = {
  readonly root: string;
  readonly touches: Touched[];
  readonly holds: Map<string, number>;
  standing: Standing | undefined;
  refused: string | null;
  seq: number;
};

const STDERR_TAIL = 4096;

//! The engine closes TypeScript and exits once its stdin ends; past this the spawner's own stop takes over.
const CLOSING = Duration.seconds(5);

const HEAP_GROWTH = 50;

const encoder = new TextEncoder();

export const makeLauncher = Effect.fnUntraced(function* (engine: Engine) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const open = Effect.fn('Launcher.open')(function* (launch: Launch) {
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(engine.runtime, [engine.entry, launch.base, ...(engine.compiler === null ? [] : [engine.compiler])], {
          cwd: launch.base,
          extendEnv: true,
          env: {
            GOMEMLIMIT: String(Math.floor(launch.memory)),
            GOMAXPROCS: String(Math.max(1, Math.floor(launch.cpus))),
            GOGC: String(HEAP_GROWTH),
          },
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      )
      .pipe(Effect.mapError((failure) => new EngineLost({ detail: `the TypeScript engine could not start: ${failure.message}` })));
    const outbox = yield* Queue.unbounded<Envelope, Cause.Done>();
    const ended = yield* Deferred.make<string>();
    const waiting = new Map<number, Deferred.Deferred<unknown, EngineLost>>();
    const seats = new Map<string, Seat>();
    let moved = yield* Deferred.make<void>();
    let next = 1;
    let stderr = '';

    const lose = Effect.fnUntraced(function* (reason: string) {
      if (yield* Deferred.isDone(ended)) return;
      yield* Deferred.succeed(ended, reason);
      for (const deferred of waiting.values()) yield* Deferred.fail(deferred, new EngineLost({ detail: reason }));
      waiting.clear();
    });

    const exited = Effect.fnUntraced(function* () {
      const code = yield* handle.exitCode.pipe(Effect.match({ onFailure: (failure) => failure.message, onSuccess: String }));
      yield* Fiber.await(tail);
      yield* lose(`the TypeScript engine exited (${code})${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}`);
    });

    const notify = (method: string, params: unknown) => Queue.offer(outbox, { _tag: 'Notification', method, params });

    const drop = (seat: Seat, revision: string) => notify(METHODS.drop, { checkout: seat.root, revision });

    const stir = Effect.fnUntraced(function* () {
      const was = moved;
      moved = yield* Deferred.make<void>();
      yield* Deferred.succeed(was, undefined);
    });

    const receive = Effect.fnUntraced(function* (line: string) {
      const message = classify(line);
      if (message === null || message._tag === 'Malformed' || message._tag === 'Request') return;
      if (message._tag === 'Result' || message._tag === 'Error') {
        const deferred = typeof message.id === 'number' ? waiting.get(message.id) : undefined;
        if (deferred === undefined || typeof message.id !== 'number') return;
        waiting.delete(message.id);
        if (message._tag === 'Result') yield* Deferred.succeed(deferred, message.result);
        else yield* Deferred.fail(deferred, new EngineLost({ detail: `the TypeScript engine could not answer: ${message.error.message}` }));
        return;
      }
      if (message.method === METHODS.standing) {
        const read = yield* Schema.decodeUnknownEffect(Standing)(message.params);
        const seat = seats.get(read.checkout);
        if (seat === undefined) return;
        const previous = seat.standing?.revision;
        seat.standing = read;
        if (previous !== undefined && previous !== read.revision && !seat.holds.has(previous)) yield* drop(seat, previous);
        while (seat.touches.length > 0 && (seat.touches[0]?.seq ?? 0) <= read.absorbed) seat.touches.shift();
        return yield* stir();
      }
      if (message.method === METHODS.drifted) {
        const read = yield* Schema.decodeUnknownEffect(Drifted)(message.params);
        const touched = seats.get(read.checkout)?.touches.find((one) => one.seq === read.seq);
        if (touched === undefined) return;
        touched.paths = [...touched.paths, ...read.paths];
        touched.known = true;
        return yield* stir();
      }
      if (message.method === METHODS.refused) {
        const read = yield* Schema.decodeUnknownEffect(Refused)(message.params);
        const seat = seats.get(read.checkout);
        if (seat === undefined) return;
        seat.refused = read.detail;
        yield* stir();
      }
    });

    yield* Effect.forkScoped(
      Stream.fromQueue(outbox).pipe(
        Stream.map((envelope) => encoder.encode(frame(envelope))),
        Stream.run(handle.stdin),
        Effect.catchTag('PlatformError', (failure) => lose(`the TypeScript engine stopped reading: ${failure.message}`)),
      ),
    );
    const tail = yield* Effect.forkScoped(
      handle.stderr.pipe(
        Stream.decodeText,
        Stream.runForEach((text) =>
          Effect.sync(() => {
            stderr = (stderr + text).slice(-STDERR_TAIL);
          }),
        ),
      ),
    );
    yield* Effect.forkScoped(
      handle.stdout.pipe(
        Stream.decodeText,
        Stream.splitLines,
        Stream.runForEach(receive),
        Effect.matchEffect({
          onFailure: (failure) => lose(`the TypeScript engine's answers could not be read: ${failure.message}`),
          onSuccess: exited,
        }),
      ),
    );
    yield* Effect.addFinalizer(() =>
      Queue.end(outbox).pipe(
        Effect.andThen(Deferred.await(ended)),
        Effect.timeoutOption(CLOSING),
        Effect.andThen(lose('the TypeScript engine was closed')),
      ),
    );

    const request = Effect.fn('Launcher.ask')(function* (seat: Seat, lease: Lease, asked: Asked) {
      if (yield* Deferred.isDone(ended)) return yield* new EngineLost({ detail: yield* Deferred.await(ended) });
      if (!lease.open) return yield* new EngineLost({ detail: `the snapshot ${lease.revision} was released when its question ended` });
      const id = next++;
      const deferred = yield* Deferred.make<unknown, EngineLost>();
      waiting.set(id, deferred);
      yield* Queue.offer(outbox, {
        _tag: 'Request',
        id,
        method: METHODS.ask,
        params: { checkout: seat.root, revision: lease.revision, asked } satisfies Asking,
      });
      return yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            waiting.delete(id);
          }).pipe(Effect.andThen(notify(METHODS.cancel, { id }))),
        ),
      );
    });

    const outOfContract = (invalid: Schema.SchemaError) =>
      new EngineLost({ detail: `the TypeScript engine answered out of contract: ${invalid.message}` });

    const adapterOf = (seat: Seat, lease: Lease): Adapter => ({
      locate: (spot) =>
        request(seat, lease, { _tag: 'locate', spot }).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(Located)(value).pipe(Effect.mapError(outOfContract))),
        ),
      judge: (judging) =>
        request(seat, lease, { _tag: 'judge', judging }).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(Judgement)(value).pipe(Effect.mapError(outOfContract))),
        ),
    });

    const release = (seat: Seat, lease: Lease) =>
      Effect.suspend(() => {
        lease.open = false;
        const left = (seat.holds.get(lease.revision) ?? 1) - 1;
        if (left > 0) {
          seat.holds.set(lease.revision, left);
          return Effect.void;
        }
        seat.holds.delete(lease.revision);
        return lease.revision === seat.standing?.revision || seats.get(seat.root) !== seat ? Effect.void : drop(seat, lease.revision);
      });

    const servedOf = Effect.fnUntraced(function* (seat: Seat) {
      const current = seat.standing;
      if (current === undefined || !current.known || seat.touches.some((one) => !one.known)) return null;
      const lease: Lease = { revision: current.revision, open: true };
      seat.holds.set(lease.revision, (seat.holds.get(lease.revision) ?? 0) + 1);
      yield* Effect.addFinalizer(() => release(seat, lease));
      const pending = seat.touches.flatMap((one) => one.paths).filter(tracked);
      const changed = [...new Set([...current.changed, ...pending])];
      return {
        snapshot: { revision: current.revision, changed, problems: current.problems },
        warming: current.warming || pending.length > 0,
        adapter: adapterOf(seat, lease),
      } satisfies Served;
    });

    const readyOf = Effect.fnUntraced(function* (seat: Seat) {
      for (;;) {
        const waiting = moved;
        if (seat.refused !== null) return yield* new CheckoutRefused({ detail: seat.refused });
        const now = yield* servedOf(seat);
        if (now !== null) return now;
        const end = yield* Effect.raceFirst(Effect.as(Deferred.await(waiting), null), Deferred.await(ended));
        if (end !== null) return yield* new EngineLost({ detail: end });
      }
    });

    const touchOf = (seat: Seat) =>
      Effect.fnUntraced(function* (one: Touch) {
        if (yield* Deferred.isDone(ended)) return yield* new EngineLost({ detail: yield* Deferred.await(ended) });
        seat.seq += 1;
        seat.touches.push({ seq: seat.seq, paths: one._tag === 'paths' ? [...one.paths] : [], known: one._tag === 'paths' });
        yield* notify(METHODS.touch, { checkout: seat.root, seq: seat.seq, touch: one });
      });

    const attach = Effect.fnUntraced(function* (root: string) {
      if (yield* Deferred.isDone(ended)) return yield* new EngineLost({ detail: yield* Deferred.await(ended) });
      const seat: Seat = { root, touches: [], holds: new Map(), standing: undefined, refused: null, seq: 0 };
      seats.set(root, seat);
      yield* notify(METHODS.attach, { checkout: root });
      return seat;
    });

    const detach = (seat: Seat) =>
      Effect.suspend(() => {
        if (seats.get(seat.root) !== seat) return Effect.void;
        seats.delete(seat.root);
        return Effect.asVoid(notify(METHODS.detach, { checkout: seat.root }));
      });

    const restOf = Effect.fnUntraced(function* (seat: Seat) {
      if (yield* Deferred.isDone(ended)) return yield* new EngineLost({ detail: yield* Deferred.await(ended) });
      yield* notify(METHODS.rest, { checkout: seat.root });
    });

    const checkout = (root: string) =>
      Effect.map(Effect.acquireRelease(attach(root), detach), (seat): Checkout => ({
        served: servedOf(seat),
        ready: readyOf(seat),
        touch: touchOf(seat),
        rest: restOf(seat),
      }));

    const usage = Effect.tryPromise({
      try: () => memoryOf(handle.pid),
      catch: (cause) =>
        new EngineLost({
          detail: `the TypeScript engine's memory could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    }).pipe(Effect.withSpan('Launcher.usage'));

    const limit = Effect.fnUntraced(function* (bytes: number) {
      if (yield* Deferred.isDone(ended)) return yield* new EngineLost({ detail: yield* Deferred.await(ended) });
      yield* notify(METHODS.limit, { bytes });
    });

    return {
      checkout,
      limit,
      usage,
      ended: Deferred.await(ended),
    } satisfies Process;
  });

  return Launcher.of({ capability: CAPABILITY, open });
});

export const launcherLayer = (engine: Engine) => Layer.effect(Launcher, makeLauncher(engine));
