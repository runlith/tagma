import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { reportPath, span } from '@runlith/testbed/fixture';
import { HANG_MS } from '@runlith/testbed/kinds';
import { Cause, Clock, Effect, Exit, Fiber, Scope } from 'effect';

export type FailureArtifact = (directory: string) => Promise<void>;
type Recording = { readonly directory: string; readonly failures: Set<FailureArtifact> };
const recording = new AsyncLocalStorage<Recording>();
const pending = new Set<FailureArtifact>();

export const onFailure = (write: FailureArtifact): (() => void) => {
  const callbacks = recording.getStore()?.failures ?? pending;
  callbacks.add(write);
  return () => callbacks.delete(write);
};

export const artifactDirectory = (file: string, name: string): string => {
  const report = reportPath();
  if (report === undefined) throw new Error('browser fixtures must run through testbed');
  const safe = `${name.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 100)}-${createHash('sha256').update(name).digest('hex').slice(0, 8)}`;
  const directory = join(
    dirname(report),
    basename(report, '.jsonl'),
    `${basename(file)}-${createHash('sha256').update(file).digest('hex').slice(0, 8)}`,
    safe,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
};

const recordingFor = (name: string, file = Bun.main): Recording => ({
  directory: artifactDirectory(file, name),
  failures: new Set(pending),
});

export const record = <A>(active: Recording, work: () => Promise<A>): Promise<A> => recording.run(active, work);

export const captureFailure = async (): Promise<void> => {
  const active = recording.getStore();
  if (active === undefined) throw new Error('no e2e artifact recording stands');
  const results = await Promise.allSettled([...active.failures].map((write) => write(active.directory)));
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `failure artifacts could not all be written to ${active.directory}: ${failures.map(String).join('; ')}`,
    );
};

export const recorded = Effect.fn('e2e.recorded')(function* <A, E>(
  name: string | Recording,
  work: (directory: string) => Effect.Effect<A, E, Scope.Scope>,
) {
  const active = typeof name === 'string' ? recordingFor(name) : name;
  const { directory } = active;
  const clock = yield* Clock.Clock;
  return yield* Effect.callback<A>((resume, signal) => {
    const running = record(active, () =>
      Effect.runPromiseExit(
        Effect.provideService(
          Effect.scoped(
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const scope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit));
                const test = yield* Effect.forkChild(restore(Effect.exit(Scope.provide(work(directory), scope))));
                const observed = yield* Effect.exit(
                  restore(
                    Effect.timeoutOrElse(Fiber.join(test), {
                      duration: HANG_MS,
                      orElse: () => Effect.die(new Error(`test timed out after ${HANG_MS}ms`)),
                    }),
                  ),
                );
                const outcome = Exit.isFailure(observed) ? Exit.failCause(observed.cause) : observed.value;
                if (Exit.isFailure(outcome)) {
                  const captured = yield* Effect.exit(Effect.tryPromise(() => captureFailure()));
                  const errors = [Cause.pretty(outcome.cause), ...(Exit.isFailure(captured) ? [Cause.pretty(captured.cause)] : [])];
                  yield* Fiber.interrupt(test);
                  const ended = yield* Fiber.await(test);
                  if (Exit.isFailure(ended) && !Cause.hasInterruptsOnly(ended.cause)) errors.push(Cause.pretty(ended.cause));
                  return yield* Effect.die(new Error(`${errors.join('\n')}\nArtifacts: ${directory}`));
                }
                return outcome.value;
              }),
            ),
          ),
          Clock.Clock,
          clock,
        ),
        { signal },
      ),
    );
    running.then(
      (exit) => resume(exit),
      (cause) => resume(Effect.die(cause)),
    );
    return Effect.flatMap(
      Effect.promise(() => running),
      (exit) => (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? Effect.failCause(exit.cause) : Effect.void),
    );
  });
});

export type RecordedFixture<A> = {
  readonly setup: Effect.Effect<void>;
  readonly run: <B, E>(work: (fixture: A, directory: string) => Effect.Effect<B, E, Scope.Scope>) => Effect.Effect<B>;
  readonly close: Effect.Effect<void>;
};
const tenant = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => span('tenant')),
    () => work,
    (stop) => Effect.sync(stop),
  );

export const recordedFixture = <A, E>(
  name: string,
  acquire: (directory: string) => Effect.Effect<A, E, Scope.Scope>,
): RecordedFixture<A> => {
  const file = Bun.main;
  let scope: Scope.Closeable | undefined;
  let active: Recording;
  let value: A;
  return {
    setup: Effect.suspend(() => {
      active = recordingFor(name, file);
      return tenant(
        recorded(active, (directory) =>
          Effect.gen(function* () {
            scope = yield* Scope.make();
            value = yield* Scope.provide(acquire(directory), scope);
          }),
        ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) && scope !== undefined ? Scope.close(scope, exit) : Effect.void))),
      );
    }),
    run: (work) => recorded(active, (directory) => work(value, directory)),
    close: Effect.suspend(() => {
      const held = scope;
      if (held === undefined) return Effect.void;
      return tenant(recorded(active, () => Scope.close(held, Exit.void))).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            scope = undefined;
          }),
        ),
      );
    }),
  };
};

export type FixtureHooks = { readonly setup: () => Promise<void>; readonly close: () => Promise<void> };
export const fixtureHooks = <A>(fixture: RecordedFixture<A>): FixtureHooks => ({
  setup: () => Effect.runPromise(fixture.setup),
  close: () => Effect.runPromise(fixture.close),
});
