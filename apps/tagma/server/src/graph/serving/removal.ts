import { Effect } from 'effect';
import { eq, inArray, or } from 'drizzle-orm';
import type { MachineStore, StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { source, block, blockField, blockTag, edge, event, farEdge, ref, searchIndex } from '../store/tables.js';
import { purgeProject } from '../../settings/store/rows.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { projectRoot, projectRootCover } from '../../workspace/store/tables.js';
import { project } from '../../projects/store/table.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import type { ProjectChanges } from '../../projects/contract/service/changes.js';
import type { Act } from '../contract/service/acts.js';
import type { Tags } from '../contract/service/vocabulary.js';
import { ActState } from '../contract/service/transaction.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting, referencing } from '../store/actWrites.js';
import { setting } from '../../settings/store/table.js';
import type { policyRows } from './policy.js';

const purging = writes('Projects.purgeGraph', [block, source, edge, farEdge, setting], projecting, referencing);

const leaving = writes('project.remove', [project]);

const recording = writes('ProjectLifecycle.remove', []);

export const projectRemoval = (input: {
  readonly db: StoreDb<'graph'>;
  readonly machine: MachineStore['Service'];
  readonly act: Act['Service'];
  readonly vocabulary: Tags['Service'];
  readonly projects: Projects['Service'];
  readonly projectChanges: ProjectChanges['Service'];
  readonly rows: ReturnType<typeof policyRows>;
}) => {
  const { db, machine, act, vocabulary, projects, projectChanges } = input;
  const { byId, resolveRef } = input.rows;

  const purgeGraph = Effect.fn('Projects.purgeGraph')(function* (projectId: number): Effect.fn.Return<void, StoreFailure, ActState> {
    const held = yield* ActState;
    held.vocabulary.add(projectId);
    yield* vocabulary.forget(projectId);
    yield* purgeProject(db, projectId);
    const ids = (yield* db.select({ id: block.id }).from(block).where(eq(block.projectId, projectId))).map((row) => row.id);
    if (ids.length === 0) return;
    yield* db.delete(source).where(inArray(source.blockId, ids));
    yield* db.delete(ref).where(or(inArray(ref.fromId, ids), inArray(ref.toId, ids)));
    yield* db.delete(edge).where(or(inArray(edge.fromId, ids), inArray(edge.toId, ids)));
    yield* db.delete(farEdge).where(inArray(farEdge.fromId, ids));
    yield* db.delete(searchIndex).where(inArray(searchIndex.blockId, ids));
    yield* db.delete(blockTag).where(inArray(blockTag.blockId, ids));
    yield* db.delete(blockField).where(inArray(blockField.blockId, ids));
    yield* db.delete(block).where(eq(block.projectId, projectId));
  });

  const takeBack = (row: ProjectRow): Effect.Effect<void, StoreFailure | GateRefusal> =>
    machine.transaction(writes('project.rollback', [threadRecord, project, projectRoot, projectRootCover]), (unit) =>
      act.unit(
        purging,
        Effect.gen(function* () {
          yield* purgeGraph(row.id);
          yield* db.delete(event).where(eq(event.projectId, row.id));
          yield* projects.forget(unit, row);
        }),
      ),
    );

  const remove = Effect.fn('ProjectLifecycle.remove')(function* (input: { ref: string }) {
    const current = yield* resolveRef(input.ref);
    return yield* machine.transaction(leaving, (unit) =>
      act.unit(
        recording,
        Effect.gen(function* () {
          const standing = yield* byId(current.id);
          yield* unit.afterCommit(projectChanges.removed.publish({ projectId: standing.id }));
          yield* projects.remove(unit, standing);
          yield* act.record('project_remove', null, {
            projectId: standing.id,
            name: standing.name,
            repoKey: standing.repoKey,
            rootPath: standing.rootPath,
          });
          return standing;
        }),
      ),
    );
  });

  return { takeBack, remove };
};
