import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Context, Effect, Schema } from 'effect';
import { CurrentTransformer, type Transformer } from 'effect/sql/Statement';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { projectedEffects, writes } from '../../../platform/contract/service/writes.js';
import { thread, threadInbox, threadRun, threadSeen } from '../../../threads/testing/doubles.js';
import { WorktreeListAnswer } from '../../../worktrees/contract/wire/rows.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { makeThreadDoors } from '../threadDoors.js';

const answer = Schema.Struct({ status: Schema.Literal('ok'), worktrees: WorktreeListAnswer });

layer(doorFixture(), { excludeTestServices: true })('worktree standings', (it) => {
  it.effect('listing reads activity clocks and the latest meaningful outcome without thread payloads or history sorting', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const project = yield* world.stealthProject();
      const made: { readonly id: string; readonly ownerId: string }[] = [];
      for (let index = 0; index < 2; index += 1) {
        const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
        expect(born.status).toBe(200);
        made.push((born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread);
      }
      const caller = made[0]!;
      const { db } = Context.get(world.runtime.owners, MachineStore);
      const units = Context.get(world.runtime.owners, MachineUnits);
      const at = new Date('2030-01-01T00:00:00.000Z');
      yield* units.write(
        projectedEffects(writes('testing.worktreeStandings', [thread(), threadRun(), threadInbox(), threadSeen()])),
        (unit) =>
          Effect.gen(function* () {
            for (const one of made) {
              yield* unit.run(db.update(thread()).set({ updatedAt: at, systemPrompt: 'stored prompt' }).where(eq(thread().id, one.id)));
              yield* unit.run(
                db.insert(threadRun()).values([
                  { id: `${one.id}:1`, threadId: one.id, ownerId: one.ownerId, status: 'completed', finishedAt: at },
                  { id: `${one.id}:2`, threadId: one.id, ownerId: one.ownerId, status: 'completed', kind: 'keep-warm', finishedAt: at },
                ]),
              );
              yield* unit.run(
                db.insert(threadInbox()).values({
                  id: `keep-warm:${one.id}:1`,
                  threadId: one.id,
                  sender: { kind: 'host' },
                  kind: 'signal',
                  body: { type: 'keep-warm', addressee: 'transport', text: 'keep warm' },
                  state: 'acknowledged',
                  deliveredToRunId: `${one.id}:2`,
                  occurredAt: at,
                }),
              );
            }
            yield* unit.run(db.insert(threadSeen()).values({ threadId: caller.id, runId: `${caller.id}:1` }));
          }),
      );
      const doors = makeThreadDoors(world, project, ['list_worktrees']);
      const placed = yield* doors.doorsFor(caller.id, caller.ownerId);
      const plans: (readonly { readonly detail: string }[])[] = [];
      const inspect: Transformer = (statement, sql) => {
        const [query, bindings] = statement.compile();
        if (!query.includes('"native_thread"."updated_at"') || !query.includes('"assignment_selection"."provenance"'))
          return Effect.succeed(statement);
        return sql.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`, bindings).pipe(
          Effect.provideService(CurrentTransformer, undefined),
          Effect.orDie,
          Effect.map((plan) => {
            plans.push(plan);
            return statement;
          }),
        );
      };
      const result = yield* doors
        .atNative('list_worktrees', { project, limit: 1 }, placed)
        .pipe(Effect.provideService(CurrentTransformer, inspect));
      if (result.class === 'refusal') return yield* Effect.die(new Error(`${result.code}: ${result.reason}`));
      const { worktrees } = yield* Schema.decodeUnknownEffect(answer)(result.value);
      expect(worktrees).toMatchObject({ shown: 1, total: 1, complete: true });
      expect(worktrees.rows[0]).toMatchObject({
        kind: 'main',
        agents: { working: 0, waiting: 0, finished: 1, standing: 2 },
        movedAt: at.toISOString(),
      });
      const plan = plans.flatMap((steps) => steps.map((step) => step.detail));
      expect(plan).toContainEqual(expect.stringMatching(/^SEARCH native_thread USING COVERING INDEX /));
      expect(plan).toContainEqual(expect.stringContaining('USING INDEX thread_run_terminal_idx'));
      expect(plan.some((step) => step.includes('TEMP B-TREE'))).toBe(false);
      expect(worktrees.rows[0]?.threads).toEqual([]);
    }),
  );
});
