import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cause, Effect, Exit, Fiber, Stream } from 'effect';
import { STOP_LADDER, STOP_LADDER_MS } from '@runlith/executions/protocol/call';
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
  'an interrupted search under the runtime spawner answers within the stop ladder and leaves no child behind, even one that ignores the interrupt and the terminate',
  () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'search-stubborn-'));
      const ready = join(dir, 'ready');
      const stubborn = join(dir, 'rg');
      writeFileSync(stubborn, `#!/bin/sh\ntrap '' INT TERM\necho $$ > ${ready}.tmp && mv ${ready}.tmp ${ready}\nexec sleep 60\n`);
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
        return existsSync(ready) ? Effect.void : Effect.andThen(Effect.sleep('10 millis'), standing);
      }).pipe(Effect.timeout('10 seconds'));
      const pid = Number(readFileSync(ready, 'utf8').trim());
      const interruptedAt = performance.now();
      yield* Fiber.interrupt(searching);
      const answeredAfter = performance.now() - interruptedAt;
      const exit = yield* Fiber.await(searching);

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(answeredAfter).toBeGreaterThanOrEqual(STOP_LADDER.killAtMs);
      expect(answeredAfter).toBeLessThan(STOP_LADDER_MS + 1_000);
      expect(pid).toBeGreaterThan(0);
      expect(alive(pid)).toBe(false);
    }),
  30_000,
);
