import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cause, Effect, Exit, Fiber, Stream } from 'effect';
import { searchContent } from '@runlith/ripgrep/run';
import { bunSpawner } from '@runlith/executions/bunSpawner';
import { searchRun } from './search';
import type { World } from './world';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it.live(
  'an interrupted search under the runtime spawner leaves no child behind, even one that ignores the interrupt and the terminate',
  () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'search-stubborn-'));
      const ready = join(dir, 'ready');
      const stubborn = join(dir, 'rg');
      writeFileSync(stubborn, `#!/bin/sh\ntrap '' INT TERM\necho $$ > ${ready}.tmp && mv ${ready}.tmp ${ready}\nexec tail -f /dev/null\n`);
      chmodSync(stubborn, 0o755);
      const world: World = {
        environment: { platform: 'darwin', shell: '/bin/sh', tmp: '/tmp', executables: { ripgrep: Effect.succeed(stubborn) } },
      };
      const searching = yield* Effect.forkChild(
        Effect.flatMap(searchRun(world, dir, 600_000), (search) => Stream.runCollect(searchContent(search, { pattern: 'needle' }))).pipe(
          Effect.provide(bunSpawner()),
        ),
      );
      yield* Effect.suspend(function standing(): Effect.Effect<void> {
        if (existsSync(ready)) return Effect.void;
        const exit = searching.pollUnsafe();
        if (exit !== undefined) {
          return Effect.die(new Error(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'The search ended before publishing readiness'));
        }
        return Effect.andThen(Effect.sleep('10 millis'), standing);
      });
      const pid = Number(readFileSync(ready, 'utf8').trim());
      yield* Fiber.interrupt(searching);
      const exit = yield* Fiber.await(searching);

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(pid).toBeGreaterThan(0);
      expect(alive(pid)).toBe(false);
    }),
);
