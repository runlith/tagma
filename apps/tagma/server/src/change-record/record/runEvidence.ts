import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { chunk, unique } from '@runlith/utils/collection';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { recordsAs } from '../../thread-record/facts.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import type { RunEvidence } from '../contract/service/record.js';
import type { RunSelection } from '../contract/wire/runFiles.js';
import { held, workspaceChange, workspaceChangeText } from '../store/tables.js';
import { placeKey, samePlace, samePlaces, type StoreShape } from './places.js';
import { withVersions } from './evidence.js';
import { retired } from './sessions.js';
import { formChangeHomes } from '../store/homes.js';

export const RUN_PATH_GROUP = 64;
const standing = (row: { readonly committedAt: Date | null; readonly withdrawnAt: Date | null }): boolean =>
  row.committedAt === null && row.withdrawnAt === null;
const RUNS_PER_STATEMENT = rowsPerStatement(1) - RUN_PATH_GROUP * 3 - 8;

export const pathsOfRuns = Effect.fn('ChangeRecord.pathsOfRuns')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  projectId: number,
  checkout: string,
  selection: RunSelection,
) {
  yield* formChangeHomes(units, store, selection.threadId);
  const paths = new Set<string>();
  for (const runs of chunk(unique(selection.runIds), RUNS_PER_STATEMENT)) {
    const rows = yield* units.read((unit) =>
      unit.run(
        store.db
          .selectDistinct({ path: workspaceChange.path })
          .from(workspaceChange)
          .where(
            and(
              eq(workspaceChange.holderProjectId, projectId),
              eq(workspaceChange.holder, selection.threadId),
              inArray(workspaceChange.runId, runs),
              eq(workspaceChange.checkout, checkout),
            ),
          ),
      ),
    );
    for (const row of rows) paths.add(row.path);
  }
  return [...paths].sort();
});

export const evidenceOfRunPaths = Effect.fn('ChangeRecord.evidenceOfRunPaths')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  places: readonly PlacedPath[],
  selection: RunSelection,
) {
  yield* formChangeHomes(units, store, selection.threadId);
  const answered = new Map(places.map((place) => [place.path, new Map<string, RunEvidence>()]));
  const asked = new Set(places.map(placeKey));
  for (const runs of chunk(unique(selection.runIds), RUNS_PER_STATEMENT)) {
    const rows = yield* units.read((unit) =>
      unit.run(
        store.db
          .select({
            id: workspaceChange.id,
            path: workspaceChange.path,
            threadId: workspaceChange.holder,
            runId: workspaceChange.runId,
            origin: workspaceChange.origin,
            mode: workspaceChange.mode,
            beforeHash: workspaceChange.beforeHash,
            afterHash: workspaceChange.afterHash,
            oldText: workspaceChangeText.oldText,
            newText: workspaceChangeText.newText,
            firstLine: workspaceChange.firstLine,
            lines: workspaceChange.lines,
            added: workspaceChange.added,
            removed: workspaceChange.removed,
            at: workspaceChange.at,
            committedAt: workspaceChange.committedAt,
            commit: workspaceChange.commit,
            withdrawnAt: workspaceChange.withdrawnAt,
            checkout: workspaceChange.checkout,
            archivedAt: sql<Date | null>`(select r.archived_at from ${recordsAs('r')} where r.id = ${workspaceChange.holder} and r.project_id = ${workspaceChange.holderProjectId})`,
          })
          .from(workspaceChange)
          .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange.id))
          .where(
            and(
              samePlaces(workspaceChange, places),
              or(held, and(eq(workspaceChange.holder, selection.threadId), inArray(workspaceChange.runId, runs))),
            ),
          ),
      ),
    );
    const versioned = [...(yield* withVersions(units, store, rows.filter(standing))), ...rows.filter((row) => !standing(row))];
    for (const { checkout, archivedAt, at, ...row } of versioned) {
      if (!asked.has(placeKey({ checkout, path: row.path }))) continue;
      answered.get(row.path)?.set(row.id, { ...row, at: at.getTime(), ended: retired(archivedAt), unresolved: false });
    }
  }
  return new Map(
    [...answered].map(([path, rows]) => [path, [...rows.values()].sort((one, two) => one.at - two.at || one.id.localeCompare(two.id))]),
  );
});

export const stateOfRuns = Effect.fn('ChangeRecord.stateOfRuns')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  place: PlacedPath,
  selection: RunSelection,
) {
  const states = new Map<string, { readonly id: string; readonly committedAt: Date | null; readonly withdrawnAt: Date | null }>();
  for (const runs of chunk(unique(selection.runIds), RUNS_PER_STATEMENT)) {
    const rows = yield* units.read((unit) =>
      unit.run(
        store.db
          .select({
            id: workspaceChange.id,
            committedAt: workspaceChange.committedAt,
            withdrawnAt: workspaceChange.withdrawnAt,
          })
          .from(workspaceChange)
          .where(
            and(
              samePlace(workspaceChange, place),
              or(held, and(eq(workspaceChange.holder, selection.threadId), inArray(workspaceChange.runId, runs))),
            ),
          ),
      ),
    );
    for (const row of rows) states.set(row.id, row);
  }
  return stateOf([...states.values()]);
});

export const stateOf = (
  rows: readonly { readonly id: string; readonly committedAt: Date | null; readonly withdrawnAt: Date | null }[],
): string =>
  JSON.stringify(
    rows
      .map((row) => [row.id, row.committedAt?.getTime() ?? null, row.withdrawnAt?.getTime() ?? null])
      .sort((one, two) => String(one[0]).localeCompare(String(two[0]))),
  );
