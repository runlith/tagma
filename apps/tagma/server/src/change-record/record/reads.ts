import { Effect } from 'effect';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import { type SQL, and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { type StoreShape, within } from './places.js';
import { held, standing as unended, workspaceChange } from '../store/tables.js';
import { projectRoot } from '../../workspace/store/tables.js';
import { readHolder } from '../store/homes.js';
import { retirementProof } from '../store/retirement.js';
import { chunk, unique } from '@runlith/utils/collection';
import { rowsPerStatement } from '../../platform/store/binds.js';
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

export const heldPathsOf = Effect.fn('WorkspaceChangeLog.heldPathsOf')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  holders: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, readonly string[]>, StoreFailure> {
  const paths = new Map<string, string[]>();
  for (const group of chunk(unique(holders), rowsPerStatement(2))) {
    const rows = yield* units.read((unit) =>
      unit.run(
        store.db
          .selectDistinct({ holder: workspaceChange.holder, path: workspaceChange.path })
          .from(workspaceChange)
          .where(and(inArray(workspaceChange.holder, group), eq(workspaceChange.checkout, checkout), held)),
      ),
    );
    for (const row of rows) paths.set(row.holder, [...(paths.get(row.holder) ?? []), row.path]);
  }
  return paths;
});

export const checkoutsOfHolders = Effect.fn('WorkspaceChangeLog.checkoutsOfHolders')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  holders: readonly string[],
): Effect.fn.Return<readonly string[], StoreFailure> {
  const checkouts = new Set<string>();
  for (const group of chunk(unique(holders), rowsPerStatement(1))) {
    const rows = yield* units.read((unit) =>
      unit.run(
        store.db
          .selectDistinct({ checkout: workspaceChange.checkout })
          .from(workspaceChange)
          .where(and(inArray(workspaceChange.holder, group), held)),
      ),
    );
    for (const row of rows) checkouts.add(row.checkout);
  }
  return [...checkouts];
});

export const commitsOfHolders = Effect.fn('WorkspaceChangeLog.commitsOfHolders')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  holders: readonly string[],
  count: number,
): Effect.fn.Return<readonly string[], StoreFailure> {
  const found = new Map<string, number>();
  for (const group of chunk(unique(holders), rowsPerStatement(2))) {
    const durable = yield* units.read((unit) =>
      unit.run(
        store.db
          .select({ commit: workspaceChange.commit, at: sql<number>`max(${workspaceChange.committedAt})` })
          .from(workspaceChange)
          .where(and(inArray(workspaceChange.holder, group), eq(workspaceChange.checkout, checkout), isNotNull(workspaceChange.commit)))
          .groupBy(workspaceChange.commit)
          .orderBy(desc(sql`max(${workspaceChange.committedAt})`))
          .limit(count),
      ),
    );
    const pending = yield* units.read((unit) =>
      unit.run(
        store.db
          .selectDistinct({ commit: retirementProof.commit })
          .from(workspaceChange)
          .innerJoin(
            retirementProof,
            and(eq(retirementProof.row, workspaceChange.id), sql`${retirementProof.after} is ${workspaceChange.afterHash}`),
          )
          .where(
            and(
              inArray(workspaceChange.holder, group),
              eq(workspaceChange.checkout, checkout),
              eq(workspaceChange.state, 'held'),
              eq(retirementProof.reason, 'committed'),
            ),
          ),
      ),
    );
    for (const row of pending) found.set(row.commit, Number.MAX_SAFE_INTEGER);
    for (const row of durable) if (row.commit !== null) found.set(row.commit, Math.max(found.get(row.commit) ?? 0, Number(row.at ?? 0)));
  }
  return [...found]
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([commit]) => commit);
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
