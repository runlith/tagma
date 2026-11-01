import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { onFailure, recorded } from './artifacts.ts';

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
