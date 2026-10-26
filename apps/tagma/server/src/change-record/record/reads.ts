import { Effect } from 'effect';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import { type SQL, and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { type StoreShape, within } from './places.js';
import { held, standing as unended, workspaceChange } from '../store/tables.js';
import { projectRoot } from '../../workspace/store/tables.js';
import { readHolder } from '../store/homes.js';
import { DURABLE_OUTCOME, type RowOutcome } from './outcomes.js';

export type ThreadPathRecord = {
  readonly path: string;
  readonly runId: string | null;
};

export const pathsOfThread = Effect.fn('WorkspaceChangeLog.pathsOfThread')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  projectId: number | null,
  threadId: string,
  checkout: string,
): Effect.Effect<readonly ThreadPathRecord[], StoreFailure> {
  return units.read((unit) =>
    Effect.gen(function* () {
      const typed = yield* unit.run(
        store.db
          .select({ path: workspaceChange.path, runId: workspaceChange.runId })
          .from(workspaceChange)
          .where(
            and(
              projectId === null ? isNull(workspaceChange.holderProjectId) : eq(workspaceChange.holderProjectId, projectId),
              eq(workspaceChange.holder, threadId),
              held,
              eq(workspaceChange.checkout, checkout),
            ),
          )
          .orderBy(workspaceChange.path, workspaceChange.at, workspaceChange.id),
      );
      const standing = new Map<string, ThreadPathRecord>();
      for (const row of typed) standing.set(row.path, { path: row.path, runId: row.runId });
      return [...standing.values()].sort((left, right) => left.path.localeCompare(right.path));
    }),
  );
});

export const movedTo = Effect.fn('WorkspaceChangeLog.movedTo')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  from: PlacedPath,
): Effect.Effect<string | null, StoreFailure> {
  return units.read((unit) =>
    Effect.map(
      unit.run(
        store.db
          .select({ path: workspaceChange.path })
          .from(workspaceChange)
          .where(and(eq(workspaceChange.checkout, from.checkout), eq(workspaceChange.movedFrom, from.path), unended))
          .orderBy(desc(workspaceChange.at), desc(workspaceChange.id))
          .limit(1),
      ),
      (rows) => rows[0]?.path ?? null,
    ),
  );
});

export const writtenOfThread = Effect.fn('WorkspaceChangeLog.writtenOfThread')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  projectId: number,
  threadId: string,
): Effect.Effect<readonly PlacedPath[], StoreFailure> {
  return readHolder(units, store, threadId, (unit) =>
    unit.run(
      store.db
        .selectDistinct({ checkout: workspaceChange.checkout, path: workspaceChange.path })
        .from(workspaceChange)
        .where(
          and(
            eq(workspaceChange.holderProjectId, projectId),
            eq(workspaceChange.holder, threadId),
            sql`${workspaceChange.state} <> 'withdrawn'`,
          ),
        ),
    ),
  );
});

export const landedOfThread = Effect.fn('WorkspaceChangeLog.landedOfThread')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  projectId: number,
  threadId: string,
  paths: readonly string[],
  checkout: string,
): Effect.Effect<ReadonlyMap<string, string>, StoreFailure> {
  if (paths.length === 0) return Effect.succeed(new Map<string, string>());
  return readHolder(units, store, threadId, (unit) =>
    unit.run(
      store.db
        .select({ path: workspaceChange.path, commit: workspaceChange.commit })
        .from(workspaceChange)
        .where(
          and(
            eq(workspaceChange.holderProjectId, projectId),
            eq(workspaceChange.holder, threadId),
            inArray(workspaceChange.path, [...new Set(paths)]),
            isNotNull(workspaceChange.commit),
            eq(workspaceChange.checkout, checkout),
          ),
        )
        .orderBy(desc(workspaceChange.committedAt), desc(workspaceChange.id))
        .pipe(
          Effect.map((rows) => {
            const landed = new Map<string, string>();
            for (const row of rows) {
              if (row.commit !== null && !landed.has(row.path)) landed.set(row.path, row.commit);
            }
            return landed;
          }),
        ),
    ),
  );
});

export const checkoutsOfThread = (units: MachineUnits['Service'], store: StoreShape, projectId: number, threadId: string) =>
  readHolder(units, store, threadId, (unit) =>
    unit
      .run(
        store.db
          .selectDistinct({ checkout: workspaceChange.checkout })
          .from(workspaceChange)
          .where(
            and(
              eq(workspaceChange.holderProjectId, projectId),
              eq(workspaceChange.holder, threadId),
              sql`${workspaceChange.state} <> 'withdrawn'`,
            ),
          ),
      )
      .pipe(Effect.map((rows) => rows.map((row) => row.checkout))),
  );

export type StampedCommit = { readonly commit: string; readonly files: number };

export const commitsOfThread = Effect.fn('WorkspaceChangeLog.commitsOfThread')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  projectId: number,
  threadId: string,
  checkout: string,
  window: { readonly from: number; readonly count: number },
  outcome: RowOutcome = DURABLE_OUTCOME,
): Effect.Effect<readonly StampedCommit[], StoreFailure> {
  const newest = sql<number>`max(${outcome.at})`;
  return readHolder(units, store, threadId, (unit) =>
    unit.run(
      store.db
        .select({ commit: outcome.commit, files: sql<number>`count(distinct ${workspaceChange.path})` })
        .from(workspaceChange)
        .leftJoin(outcome.from, outcome.on)
        .where(
          and(
            eq(workspaceChange.holderProjectId, projectId),
            eq(workspaceChange.holder, threadId),
            isNotNull(outcome.commit),
            eq(workspaceChange.checkout, checkout),
          ),
        )
        .groupBy(outcome.commit)
        .orderBy(desc(newest), outcome.commit)
        .limit(window.count)
        .offset(window.from)
        .pipe(Effect.map((rows) => rows.flatMap((row) => (row.commit === null ? [] : [{ commit: row.commit, files: Number(row.files) }])))),
    ),
  );
});

export const pathsOfCommit = Effect.fn('WorkspaceChangeLog.pathsOfCommit')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  placeProjectId: number,
  threadId: string,
  commit: string,
  checkout: string,
): Effect.Effect<ReadonlySet<string>, StoreFailure> {
  return readHolder(units, store, threadId, (unit) =>
    unit.run(
      store.db
        .selectDistinct({ path: workspaceChange.path })
        .from(workspaceChange)
        .where(
          and(
            eq(workspaceChange.projectId, placeProjectId),
            eq(workspaceChange.holder, threadId),
            eq(workspaceChange.commit, commit),
            eq(workspaceChange.checkout, checkout),
          ),
        )
        .pipe(Effect.map((rows) => new Set(rows.map((row) => row.path)))),
    ),
  );
});

export const coveringProject = Effect.fn('WorkspaceChangeLog.coveringProject')(function (
  store: StoreShape,
  rootId: string,
): Effect.Effect<number | null, StoreFailure> {
  return Effect.map(
    store.db.select({ projectId: projectRoot.projectId }).from(projectRoot).where(eq(projectRoot.rootId, rootId)).limit(1),
    (rows) => rows[0]?.projectId ?? null,
  );
});

export const heldPathsOfProject = Effect.fn('WorkspaceChangeLog.heldPathsOfProject')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
): Effect.Effect<readonly string[], StoreFailure> {
  return units.read((unit) =>
    unit.run(
      store.db
        .selectDistinct({ path: workspaceChange.path })
        .from(workspaceChange)
        .where(and(eq(workspaceChange.checkout, checkout), held))
        .orderBy(workspaceChange.path)
        .pipe(Effect.map((rows) => rows.map((row) => row.path))),
    ),
  );
});
