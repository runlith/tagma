import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { arch, cpus, platform, totalmem } from 'node:os';
import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import { Clock, Context, Effect, Schema } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { projectedEffects, writes } from '../../../platform/contract/service/writes.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { thread, threadRun } from '../../../threads/testing/doubles.js';
import { WorktreeListAnswer } from '../../../worktrees/contract/wire/rows.js';
import { makeDoorWorld } from '../doorFixture.js';
import { makeThreadDoors } from '../threadDoors.js';

const members = Number(Bun.argv[2] ?? 3500);
const runs = Number(Bun.argv[3] ?? 8);
const promptBytes = Number(Bun.argv[4] ?? 65_536);
if (![members, runs, promptBytes].every((value) => Number.isSafeInteger(value) && value > 0))
  throw new Error('usage: worktreeStandings.bench.ts [threads] [runs-per-thread] [prompt-bytes]');

const answer = Schema.Struct({ status: Schema.Literal('ok'), worktrees: WorktreeListAnswer });

const main = Effect.gen(function* () {
  const world = yield* makeDoorWorld({ own: 'the benchmark owns its runtime and seeded workload until measurement ends' });
  const clock = yield* Clock.Clock;
  const project = yield* world.stealthProject();
  const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
  if (born.status !== 200) return yield* Effect.die(new Error(`create_thread answered ${born.status}`));
  const caller = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
  const { db } = Context.get(world.runtime.owners, MachineStore);
  const units = Context.get(world.runtime.owners, MachineUnits);
  const prompt = 'x'.repeat(promptBytes);
  const at = new Date(yield* Clock.currentTimeMillis);
  yield* units.write(projectedEffects(writes('worktreeStandings.bench.seed', [threadRecord(), thread(), threadRun()])), (unit) =>
    Effect.gen(function* () {
      for (let member = 0; member < members; member += 1) {
        const id = member === 0 ? caller.id : uuidv7();
        if (member === 0) yield* unit.run(db.update(thread()).set({ systemPrompt: prompt }).where(eq(thread().id, id)));
        else {
          yield* unit.run(
            db.insert(threadRecord()).values({
              id,
              projectId: project,
              origin: 'scoped',
              spawnRootId: id,
              principalId: caller.ownerId,
              agentId: 'tagma',
            }),
          );
          yield* unit.run(db.insert(thread()).values({ id, cacheGroup: id, provider: 'external', systemPrompt: prompt, updatedAt: at }));
        }
        yield* unit.run(
          db.insert(threadRun()).values(
            Array.from({ length: runs }, (_, index) => ({
              id: `${id}:${String(index).padStart(8, '0')}`,
              threadId: id,
              ownerId: caller.ownerId,
              status: 'completed' as const,
              finishedAt: at,
            })),
          ),
        );
      }
    }),
  );
  const doors = makeThreadDoors(world, project, ['list_worktrees']);
  const placed = yield* doors.doorsFor(caller.id, caller.ownerId);
  const readings: number[] = [];
  for (let read = 0; read < 3; read += 1) {
    const started = clock.monotonicTimeNanosUnsafe();
    const result = yield* doors.atNative('list_worktrees', { project, limit: 1 }, placed);
    const elapsedMs = Number(clock.monotonicTimeNanosUnsafe() - started) / 1_000_000;
    if (result.class === 'refusal') return yield* Effect.die(new Error(`${result.code}: ${result.reason}`));
    const { worktrees } = yield* Schema.decodeUnknownEffect(answer)(result.value);
    const main = worktrees.rows[0];
    if (worktrees.total !== 1 || main?.agents.standing !== members || main.agents.finished !== members)
      return yield* Effect.die(new Error(`list_worktrees did not preserve ${members} unseen outcomes`));
    readings.push(elapsedMs);
  }
  console.log(
    JSON.stringify({
      machine: { platform: platform(), arch: arch(), cores: cpus().length, memoryGiB: totalmem() / 2 ** 30 },
      members,
      runsPerThread: runs,
      promptBytesPerThread: promptBytes,
      worktrees: 1,
      measured: 'native list_worktrees, limit 1, including git and state reads',
      sqliteCache: 'first listing after seeding, then two repeated listings; OS cache is uncontrolled',
      firstReadMs: readings[0],
      repeatedReadMs: readings.slice(1),
    }),
  );
});

BunRuntime.runMain(main.pipe(Effect.scoped));
