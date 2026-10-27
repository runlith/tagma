import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Fiber, FileSystem } from 'effect';
import { join } from 'node:path';
import { watch } from 'node:fs';
import { spawnedEffect } from './spawn.js';

it.live('interrupting a spawned command reaps its child before cancellation returns', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped();
    const path = join(root, 'ready');
    const ready = Promise.withResolvers<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        watch(root, (_kind, name) => {
          if (name === 'ready') ready.resolve();
        }).on('error', ready.reject),
      ),
      (watcher) => Effect.sync(() => watcher.close()),
    );
    const script = `import { renameSync } from 'node:fs'; await Bun.write(${JSON.stringify(path + '.tmp')}, String(process.pid)); renameSync(${JSON.stringify(path + '.tmp')}, ${JSON.stringify(path)}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`;
    const child = yield* Effect.forkScoped(spawnedEffect([process.execPath, '-e', script]));
    yield* Effect.promise(() => ready.promise);
    const pid = Number(yield* files.readFileString(path));
    expect(yield* Effect.try(() => process.kill(pid, 0))).toBe(true);
    yield* Fiber.interrupt(child);
    const gone = yield* Effect.result(Effect.try(() => process.kill(pid, 0)));
    expect(gone).toMatchObject({ _tag: 'Failure', failure: { cause: { code: 'ESRCH' } } });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
