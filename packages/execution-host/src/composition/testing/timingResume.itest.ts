import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { join } from 'node:path';
import { Clock, Deferred, Effect, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { kernelClock } from '../../KernelClock';
import { loadLibrary } from '../../posix/Library';
import { HOLDER_LIBRARY } from '../../posix/testing/holder';
import { stateDirectories } from '../../hostFixture';
import { ExecutionStore } from '../../store/ExecutionStore';
import { CALL_MS, operation, ownersOver, storeOver, worldOf } from '../../testing/timingFixture';
import { LEADER } from '../../testing/processWorld';

const directories = stateDirectories('timing-resume-');
afterAll(directories.clear);

const SLACK_MS = 500;
const Written = Schema.fromJsonString(
  Schema.Struct({
    generation: Schema.Number,
    call: Schema.Struct({ budget: Schema.Struct({ timeoutMs: Schema.Number }), timing: Schema.Struct({ expiresAt: Schema.String }) }),
    rules: Schema.Array(Schema.Struct({ pid: Schema.Number, dueMs: Schema.Number })),
    pace: Schema.Struct({ initial: Schema.String, target: Schema.String }),
  }),
);

it.live(
  'a call armed, a rule bound and a pace set in one process fall due, bind and hold in the next at the instants they were written on the kernel clock',
  () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const writer = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn([process.execPath, 'run', join(import.meta.dir, 'timingResume.writer.ts'), directory, HOLDER_LIBRARY], {
            stdout: 'pipe',
            stderr: 'inherit',
          }),
        ),
        (child) =>
          Effect.andThen(
            Effect.sync(() => {
              if (child.exitCode === null) child.kill('SIGKILL');
            }),
            Effect.promise(() => child.exited),
          ),
      );
      const written = yield* Schema.decodeUnknownEffect(Written)(yield* Effect.promise(() => new Response(writer.stdout).text()));
      expect(yield* Effect.promise(() => writer.exited)).toBe(0);
      expect(written.call.budget.timeoutMs).toBe(CALL_MS);
      expect(written.pace).toEqual({ initial: 'full', target: 'low' });

      const loaded = yield* loadLibrary(HOLDER_LIBRARY);
      const clock = yield* kernelClock(() => loaded.abi.uptimeNanos());
      const reopened = yield* Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const owners = yield* ownersOver(store, worldOf(), 50, true);
        const decision = yield* owners.calls.awaitDecision(operation);
        const decidedAt = loaded.abi.uptimeNanos();
        const deadline = yield* owners.calls.deadline(operation);
        yield* Deferred.await(owners.killed);
        return { decision, decidedAt, deadline, owners };
      }).pipe(Effect.provide(storeOver(directory, yield* sharedPool, written.generation)), Effect.provideService(Clock.Clock, clock));

      const expiresAt = BigInt(written.call.timing.expiresAt);
      expect(reopened.decision._tag).toBe('Cancelled');
      expect(reopened.decidedAt).toBeGreaterThanOrEqual(expiresAt);
      expect(reopened.decidedAt - expiresAt).toBeLessThan(BigInt(SLACK_MS) * 1_000_000n);
      expect(reopened.deadline.executionMs).toBe(CALL_MS);

      const [pid, killedAtMs] = reopened.owners.killedAtMs[0]!;
      const due = written.rules.find((one) => one.pid === pid)!.dueMs;
      expect(killedAtMs).toBeGreaterThanOrEqual(due);
      expect(killedAtMs - due).toBeLessThan(SLACK_MS);
      expect(reopened.owners.applied.map((one) => [one.pid, one.initial, one.pace])).toContainEqual([LEADER, 'full', 'low']);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
