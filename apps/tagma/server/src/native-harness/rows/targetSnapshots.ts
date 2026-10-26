import { and, eq, inArray, sql } from 'drizzle-orm';
import { entryField } from '../../threads/store/fields.js';
import { Effect, Schema } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { targetSnapshot } from '../store/thread.js';
import { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import type { TargetAt } from '../../workspace/contract/wire/place.js';
import { TargetSnapshot } from '../../threads/contract/wire/target.js';
import { TargetSnapshots, TargetStorageFailed, type ActiveTarget } from '../../threads/contract/service/targetSnapshots.js';

const decode = Schema.decodeUnknownEffect(TargetSnapshot);

type Row = typeof targetSnapshot.$inferSelect;

const recording = writes('TargetSnapshots.record', [targetSnapshot]);

const decoded = Effect.fn('TargetSnapshotStore.decoded')(function* (row: Row) {
  return yield* decode({
    work: { projectId: row.projectId, threadId: row.threadId },
    runId: row.runId,
    generation: row.generation,
    sourceKey: row.sourceKey,
    workingRoot: row.workingRoot,
    place: row.place ?? null,
    graph: { projectId: row.projectId, root: row.graphRoot },
    admittedAt: row.admittedAt,
  }).pipe(Effect.mapError((cause) => new TargetStorageFailed({ key: `${row.threadId}/${row.runId}/${row.generation}`, cause })));
});

export const makeTargetSnapshots = Effect.gen(function* () {
  const { db } = yield* MachineStore;

  const at = Effect.fn('TargetSnapshotStore.at')(function* (key: TargetAt, unit: Unit<'machine'>) {
    const row = yield* unit.run(
      db
        .select()
        .from(targetSnapshot)
        .where(
          and(
            eq(targetSnapshot.threadId, key.threadId),
            eq(targetSnapshot.runId, key.runId),
            eq(targetSnapshot.generation, key.generation),
          ),
        )
        .get(),
    );
    return row === undefined ? undefined : yield* decoded(row);
  });

  return TargetSnapshots.of({
    writes: recording,
    at,
    record: Effect.fn('TargetSnapshotStore.record')(function* (target, unit) {
      yield* unit.run(
        db
          .insert(targetSnapshot)
          .values({
            threadId: target.work.threadId,
            runId: target.runId,
            generation: target.generation,
            sourceKey: target.sourceKey,
            projectId: target.work.projectId,
            workingRoot: target.workingRoot,
            graphRoot: target.graph.root,
            place: target.place,
            admittedAt: target.admittedAt,
          })
          .onConflictDoNothing(),
      );
      const stood = yield* at({ threadId: target.work.threadId, runId: target.runId, generation: target.generation }, unit);
      if (stood === undefined) {
        return yield* new TargetStorageFailed({
          key: `${target.work.threadId}/${target.runId}/${target.generation}`,
          cause: new Error('The target this unit recorded cannot be read back in the same unit.'),
        });
      }
      return stood;
    }),
    readActive: Effect.fn('TargetSnapshotStore.readActive')(function* (threadId, unit) {
      const active = yield* unit.run(
        db.all<{ run_id: string; generation: unknown }>(sql`
            select r.id as run_id,
                   coalesce(max(case
                     when e.type = 'context-change'
                      and ${entryField(sql.raw('e.entry'), 'status')} = 'published'
                     then ${entryField(sql.raw('e.entry'), 'generation')}
                   end), 0) as generation
              from thread_run r
              left join thread_entry e on e.thread_id = r.thread_id and e.run_id = r.id
             where r.thread_id = ${threadId} and r.status = 'running'
             group by r.id
          `),
      );
      const running = active[0];
      if (running === undefined) return { state: 'unavailable', reason: 'no-run' } satisfies ActiveTarget;
      const counted = running.generation;
      if (typeof counted !== 'number' || !Number.isInteger(counted) || counted < 0) {
        return yield* new TargetStorageFailed({
          key: `${threadId}/${running.run_id}`,
          cause: new Error(`The log records generation ${JSON.stringify(counted)} for this run, which is no generation.`),
        });
      }
      const generation = WorkspaceGeneration.make(counted);
      const target = yield* at({ threadId, runId: running.run_id, generation }, unit);
      return target === undefined
        ? ({ state: 'unavailable', reason: 'no-target', runId: running.run_id, generation } satisfies ActiveTarget)
        : ({ state: 'admitted', target } satisfies ActiveTarget);
    }),
    origins: Effect.fn('TargetSnapshotStore.origins')(function* (threadId, runIds, unit) {
      if (runIds !== null && runIds.length === 0) return [];
      return yield* unit.run(
        db
          .selectDistinct({ projectId: targetSnapshot.projectId, root: targetSnapshot.graphRoot })
          .from(targetSnapshot)
          .where(
            runIds === null
              ? eq(targetSnapshot.threadId, threadId)
              : and(eq(targetSnapshot.threadId, threadId), inArray(targetSnapshot.runId, [...runIds])),
          ),
      );
    }),
  });
});
