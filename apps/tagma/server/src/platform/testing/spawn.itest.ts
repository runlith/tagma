import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Fiber, FileSystem, Stream } from 'effect';
import { join } from 'node:path';
import { spawnedEffect } from './spawn.js';

it.live('interrupting a spawned command reaps its child before cancellation returns', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped();
    const path = join(root, 'ready');
    const ready = yield* Stream.toPull(files.watch(root).pipe(Stream.filter((event) => event._tag === 'Create' && event.path === 'ready')));
    const script = `import { renameSync } from 'node:fs'; await Bun.write(${JSON.stringify(path + '.tmp')}, String(process.pid)); renameSync(${JSON.stringify(path + '.tmp')}, ${JSON.stringify(path)}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`;
    const child = yield* Effect.forkScoped(spawnedEffect([process.execPath, '-e', script]));
    yield* ready;
    const pid = Number(yield* files.readFileString(path));
    expect(yield* Effect.try(() => process.kill(pid, 0))).toBe(true);
    yield* Fiber.interrupt(child);
    const gone = yield* Effect.result(Effect.try(() => process.kill(pid, 0)));
    expect(gone).toMatchObject({ _tag: 'Failure', failure: { cause: { code: 'ESRCH' } } });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
