import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Fiber, FileSystem, PlatformError, Sink, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { Git, gitLayer } from '@runlith/git/Git';
import { CheckoutBaselines } from './CheckoutBaselines';
import { readable, type Reading } from './checkoutState';
import { CheckoutFlights } from './CheckoutFlights';
import { toolOptions } from './testing/options';
import { resolveToolOptions } from './workspace/runtime';

const ROOT = '/checkout';
const resolved = resolveToolOptions(
  toolOptions({
    cwd: ROOT,
    world: {
      environment: { platform: 'darwin', shell: '/bin/sh', tmp: '/tmp', executables: { ripgrep: Effect.succeed('rg') } },
    },
  }),
);
const HEAD = `${'a'.repeat(40)}\n`;

type Measurement = { readonly started: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> };

const checkout = () => {
  const measurements: Measurement[] = Array.from({ length: 4 }, () => ({
    started: Deferred.makeUnsafe<void>(),
    release: Deferred.makeUnsafe<void>(),
  }));
  let statuses = 0;
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      if (command._tag !== 'StandardCommand') throw new Error('git runs one command at a time');
      const status = command.args.includes('status');
      const measurement = status ? measurements[statuses] : undefined;
      if (status) {
        if (measurement === undefined) throw new Error('more measurements than the case allows');
        statuses += 1;
        Deferred.doneUnsafe(measurement.started, Exit.void);
      }
      const text = status ? ` M m${statuses}\0` : HEAD;
      const released = measurement === undefined ? Effect.void : Deferred.await(measurement.release);
      const stdout = Stream.fromEffect(released.pipe(Effect.as(new TextEncoder().encode(text))));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: released.pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout,
        stderr: Stream.empty,
        all: stdout,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    }),
  );
  return { measurements, spawner };
};

const names = (reading: Reading): readonly string[] => [...(readable(reading)?.keys() ?? [])];

const run = <A>(spawner: ChildProcessSpawner.ChildProcessSpawner['Service'], body: Effect.Effect<A, never, FileSystem.FileSystem | Git>) =>
  body.pipe(
    Effect.provide(gitLayer),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        stat: () => Effect.fail(PlatformError.systemError({ _tag: 'NotFound', module: 'FileSystem', method: 'stat' })),
      }),
    ),
  );

describe('measurement flights of one checkout', () => {
  it.effect(
    'shares one measurement that starts after the running one among everyone who asked while it ran, and starts a lone ask at once',
    () =>
      Effect.gen(function* () {
        const { measurements, spawner } = checkout();
        const [m1, m2, m3] = measurements as [Measurement, Measurement, Measurement];
        const baselines = new CheckoutBaselines(new CheckoutFlights());
        const measure = baselines.measure(ROOT, resolved);
        const result = yield* run(
          spawner,
          Effect.gen(function* () {
            const first = yield* Effect.forkChild(measure);
            yield* Deferred.await(m1.started);
            const second = yield* Effect.forkChild(measure, { startImmediately: true });
            const third = yield* Effect.forkChild(measure, { startImmediately: true });
            const queuedStartedEarly = Deferred.isDoneUnsafe(m2.started);
            yield* Deferred.succeed(m1.release, undefined);
            const firstReading = yield* Fiber.join(first);
            yield* Deferred.await(m2.started);
            yield* Deferred.succeed(m2.release, undefined);
            const secondReading = yield* Fiber.join(second);
            const thirdReading = yield* Fiber.join(third);
            const lone = yield* Effect.forkChild(measure);
            yield* Deferred.await(m3.started);
            yield* Deferred.succeed(m3.release, undefined);
            const loneReading = yield* Fiber.join(lone);
            return { queuedStartedEarly, firstReading, secondReading, thirdReading, loneReading };
          }),
        );
        expect(result.queuedStartedEarly).toBe(false);
        expect(names(result.firstReading)).toEqual(['m1']);
        expect(names(result.secondReading)).toEqual(['m2']);
        expect(result.thirdReading).toBe(result.secondReading);
        expect(names(result.loneReading)).toEqual(['m3']);
        expect('head' in result.loneReading && result.loneReading.head).toEqual({ commit: HEAD.trim() });
      }),
  );

  it.effect('keeps a shared measurement going for the others when one of its askers is interrupted', () =>
    Effect.gen(function* () {
      const { measurements, spawner } = checkout();
      const [m1, m2] = measurements as [Measurement, Measurement];
      const baselines = new CheckoutBaselines(new CheckoutFlights());
      const measure = baselines.measure(ROOT, resolved);
      const readings = yield* run(
        spawner,
        Effect.gen(function* () {
          const starter = yield* Effect.forkChild(measure);
          yield* Deferred.await(m1.started);
          const leaving = yield* Effect.forkChild(measure, { startImmediately: true });
          const staying = yield* Effect.forkChild(measure, { startImmediately: true });
          yield* Fiber.interrupt(leaving);
          yield* Deferred.succeed(m1.release, undefined);
          yield* Deferred.await(m2.started);
          yield* Deferred.succeed(m2.release, undefined);
          return { started: yield* Fiber.join(starter), stayed: yield* Fiber.join(staying) };
        }),
      );
      expect(names(readings.started)).toEqual(['m1']);
      expect(names(readings.stayed)).toEqual(['m2']);
    }),
  );

  it.effect('stops a measurement nobody waits for any more, so a hung reading does not hold the checkout for later asks', () =>
    Effect.gen(function* () {
      const { measurements, spawner } = checkout();
      const [m1, m2] = measurements as [Measurement, Measurement];
      const baselines = new CheckoutBaselines(new CheckoutFlights());
      const measure = baselines.measure(ROOT, resolved);
      const reading = yield* run(
        spawner,
        Effect.gen(function* () {
          const abandoned = yield* Effect.forkChild(measure);
          yield* Deferred.await(m1.started);
          yield* Fiber.interrupt(abandoned);
          const later = yield* Effect.forkChild(measure);
          yield* Deferred.await(m2.started);
          yield* Deferred.succeed(m2.release, undefined);
          return yield* Fiber.join(later);
        }),
      );
      expect(names(reading)).toEqual(['m2']);
    }),
  );
});
