import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Deferred, Effect, Fiber, FileSystem } from 'effect';
import { pool } from './inspectionLanes.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('worker retirement', (it) => {
  it.effect('interrupting a slice job retires its retained worker before serving another request', () =>
    Effect.gen(function* () {
      const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'inspection-retirement-' });
      const entry = join(home, 'worker.ts');
      const retired = join(home, 'retired');
      writeFileSync(
        entry,
        `import { writeFileSync } from 'node:fs';
let served = 0;
self.addEventListener('message', ({ data }) => {
  if (data.kind === 'rest') writeFileSync(${JSON.stringify(retired)}, 'retired');
  postMessage({ id: data.id, answered: true, verdict: { violations: [], unjudged: [] }, read: [], ms: ++served });
});\n`,
      );
      const held = yield* Effect.acquireRelease(
        Effect.sync(() => pool(pathToFileURL(entry), ['retiring test worker'], { idleMs: 1 })),
        (opened) => Effect.sync(() => opened.close()),
      );
      const entered = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          watch(home, (_, name) => {
            if (name === 'retired') Deferred.doneUnsafe(stopped, Effect.void);
          }),
        ),
        (watcher) => Effect.sync(() => watcher.close()),
      );
      const job = yield* Effect.forkChild(
        held.job(undefined, (answer) =>
          answer({ kind: 'packs', root: home, commit: 'HEAD' }).pipe(
            Effect.andThen(Deferred.succeed(entered, undefined)),
            Effect.andThen(Effect.never),
          ),
        ),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(job);
      yield* Deferred.await(stopped);
      const answer = yield* held.answer({ kind: 'packs', root: home, commit: 'HEAD' });
      expect('verdict' in answer ? answer.ms : null).toBe(1);
    }),
  );
});
