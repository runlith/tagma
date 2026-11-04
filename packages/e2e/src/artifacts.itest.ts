import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { onFailure, recorded, recordingFor } from './artifacts.ts';
import { HANG_MS } from '@runlith/testbed/kinds';
import { TestClock } from 'effect/testing';

it.live('a body failure records evidence before releasing its fixture', () =>
  Effect.gen(function* () {
    let open = true;
    let artifact = '';
    const exit = yield* Effect.exit(
      recorded('failed recording', (directory) =>
        Effect.gen(function* () {
          artifact = join(directory, 'evidence.txt');
          const stop = onFailure(() => writeFile(artifact, open ? 'failure evidence' : 'resource already closed', { flag: 'wx' }));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              open = false;
              stop();
            }),
          );
          return yield* Effect.fail('body failed');
        }),
      ),
    );
    expect(readFileSync(artifact, 'utf8')).toBe('failure evidence');
    expect(open).toBe(false);
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain('body failed');
  }),
);

it.effect('the hang bound captures evidence before releasing its fixture', () =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<string>();
    let open = true;
    const running = yield* Effect.forkChild(
      recorded('timed recording', (directory) =>
        Effect.gen(function* () {
          const stop = onFailure((path) => writeFile(join(path, 'evidence.txt'), open ? 'failure evidence' : 'resource already closed'));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              open = false;
              stop();
            }),
          );
          yield* Deferred.succeed(ready, directory);
          return yield* Effect.never;
        }),
      ),
    );
    const directory = yield* Deferred.await(ready);
    yield* TestClock.adjust(HANG_MS);
    const exit = yield* Fiber.await(running);
    expect(readFileSync(join(directory, 'evidence.txt'), 'utf8')).toBe('failure evidence');
    expect(open).toBe(false);
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(`Artifacts: ${directory}`);
  }),
);

it.effect('fixture setup and body keep separate guards and share live failure evidence', () =>
  Effect.gen(function* () {
    const recording = recordingFor('fixture phases');
    const fixture = yield* Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit));
    const ready = yield* Deferred.make<void>();
    let open = true;
    const setup = yield* Effect.forkChild(
      recorded(recording, (directory) =>
        Scope.provide(
          Effect.gen(function* () {
            const stop = onFailure(() => writeFile(join(directory, 'evidence.txt'), open ? 'failure evidence' : 'resource already closed'));
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                open = false;
                stop();
              }),
            );
            yield* Deferred.succeed(ready, undefined);
            yield* Effect.sleep(HANG_MS - 1);
          }),
          fixture,
        ),
      ),
    );
    yield* Deferred.await(ready);
    yield* TestClock.adjust(HANG_MS - 1);
    yield* Fiber.join(setup);
    const entered = yield* Deferred.make<void>();
    const running = yield* Effect.forkChild(
      recorded(recording, () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* Effect.sleep(HANG_MS - 1);
          return yield* Effect.fail('body failed');
        }),
      ),
    );
    yield* Deferred.await(entered);
    yield* TestClock.adjust(HANG_MS - 1);
    const exit = yield* Fiber.await(running);
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain('body failed');
    expect(readFileSync(join(recording.directory, 'evidence.txt'), 'utf8')).toBe('failure evidence');
    expect(open).toBe(true);
    yield* Scope.close(fixture, exit);
    expect(open).toBe(false);
  }),
);

it.live('interruption records failure evidence before releasing the test scope', () =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<string>();
    const running = yield* Effect.forkChild(
      recorded('interrupted recording', (directory) =>
        Effect.gen(function* () {
          let open = true;
          const stop = onFailure((path) => writeFile(join(path, 'evidence.txt'), open ? 'failure evidence' : 'resource already closed'));
          yield* Effect.addFinalizer(() => Effect.sync(stop));
          return yield* Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.sync(() => (open = false)));
              yield* Deferred.succeed(ready, directory);
              return yield* Effect.never;
            }),
          );
        }),
      ),
    );
    const directory = yield* Deferred.await(ready);
    yield* Fiber.interrupt(running);
    const exit = yield* Fiber.await(running);
    expect(readFileSync(join(directory, 'evidence.txt'), 'utf8')).toBe('failure evidence');
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(`Artifacts: ${directory}`);
  }),
);
