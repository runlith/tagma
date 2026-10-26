import { Effect } from 'effect';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { type StoreShape, placeKey, samePlaces } from './places.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { held, workspaceChange, workspaceChangeText, workspaceChangeContent } from '../store/tables.js';
import { chunk, unique } from '@runlith/utils/collection';
import { retired } from './sessions.js';
import { recordsAs } from '../../thread-record/facts.js';
import { rowsPerStatement } from '../../platform/store/binds.js';

export type VersionContent =
  | { readonly _tag: 'absent' }
  | { readonly _tag: 'text'; readonly text: string }
  | { readonly _tag: 'unavailable' };

export type RecordedChange = {
  readonly id: string;
  readonly path: string;
  readonly threadId: string;
  readonly origin: 'edit' | 'write' | 'delete';
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly beforeContent?: VersionContent;
  readonly afterContent?: VersionContent;
  readonly oldText: string | null;
  readonly newText: string | null;
  readonly mode?: string | null;
};

export type ResolvedChange = RecordedChange & {
  readonly ended: boolean;
  readonly unresolved: boolean;
};

export type OrderedChange = ResolvedChange & { readonly at: number };

const claimed = {
  id: workspaceChange.id,
  path: workspaceChange.path,
  threadId: workspaceChange.holder,
  origin: workspaceChange.origin,
  beforeHash: workspaceChange.beforeHash,
  afterHash: workspaceChange.afterHash,
  oldText: workspaceChangeText.oldText,
  newText: workspaceChangeText.newText,
  mode: workspaceChange.mode,
};

const placedBy = (group: readonly PlacedPath[]) => {
  const byKey = new Map(group.map((place) => [placeKey(place), place] as const));
  return (row: { readonly checkout: string; readonly path: string }): PlacedPath | undefined => byKey.get(placeKey(row));
};

const DIGESTS_PER_STATEMENT = rowsPerStatement(1);

export const versionTexts = Effect.fn('WorkspaceChangeLog.versionTexts')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  digests: readonly string[],
): Effect.Effect<ReadonlyMap<string, string>, StoreFailure> {
  return units.read(
    (unit) =>
      Effect.gen(function* () {
        const texts = new Map<string, string>();
        for (const part of chunk(unique(digests), DIGESTS_PER_STATEMENT)) {
          const rows = yield* unit.run(
            store.db
              .select({ digest: workspaceChangeContent.digest, text: workspaceChangeContent.text })
              .from(workspaceChangeContent)
              .where(inArray(workspaceChangeContent.digest, part)),
          );
          for (const row of rows) texts.set(row.digest, row.text);
        }
        return texts;
      }),
    { bulk: true },
  );
});

const absentVersion: VersionContent = { _tag: 'absent' };

const unavailableVersion: VersionContent = { _tag: 'unavailable' };

function versioned<Row extends Pick<RecordedChange, 'origin' | 'beforeHash' | 'afterHash'>>(
  texts: ReadonlyMap<string, string>,
  row: Row,
): Row & Pick<RecordedChange, 'beforeContent' | 'afterContent'> {
  const before = row.beforeHash === null ? undefined : texts.get(row.beforeHash);
  const after = row.afterHash === null ? undefined : texts.get(row.afterHash);
  return {
    ...row,
    beforeContent: before === undefined ? unavailableVersion : { _tag: 'text', text: before },
    afterContent: row.origin === 'delete' ? absentVersion : after === undefined ? unavailableVersion : { _tag: 'text', text: after },
  };
}

export const withVersions = Effect.fnUntraced(function* <Row extends Pick<RecordedChange, 'origin' | 'beforeHash' | 'afterHash'>>(
  units: MachineUnits['Service'],
  store: StoreShape,
  rows: readonly Row[],
): Effect.fn.Return<(Row & Pick<RecordedChange, 'beforeContent' | 'afterContent'>)[], StoreFailure> {
  if (rows.length === 0) return [];
  const digests = rows.flatMap((row) => [row.beforeHash, row.afterHash]).filter((digest): digest is string => digest !== null);
  const texts = yield* versionTexts(units, store, digests);
  return rows.map((row) => versioned(texts, row));
});

export const heldOfThread = Effect.fn('WorkspaceChangeLog.heldOfThread')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  projectId: number,
  threadId: string,
): Effect.Effect<readonly RecordedChange[], StoreFailure> {
  return units.read((unit) =>
    unit.run(
      store.db
        .select(claimed)
        .from(workspaceChange)
        .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange.id))
        .where(and(eq(workspaceChange.holderProjectId, projectId), eq(workspaceChange.holder, threadId), held))
        .orderBy(workspaceChange.path, workspaceChange.at, workspaceChange.id),
    ),
  );
});

const EVIDENCE_GROUP = 64;

type HeldEvidence = Omit<OrderedChange, 'at' | 'beforeContent' | 'afterContent'> & { readonly at: Date };

const evidenceOfGroup = Effect.fn('WorkspaceChangeLog.evidenceOfPlaces')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  group: readonly PlacedPath[],
): Effect.Effect<ReadonlyMap<string, readonly OrderedChange[]>, StoreFailure> {
  return Effect.gen(function* () {
    const typed = yield* units.read(
      (unit) =>
        unit.run(
          store.db
            .select({
              ...claimed,
              checkout: workspaceChange.checkout,
              at: workspaceChange.at,
              archivedAt: sql<Date | null>`(select r.archived_at from ${recordsAs('r')} where r.id = ${workspaceChange.holder} and r.project_id = ${workspaceChange.holderProjectId})`,
            })
            .from(workspaceChange)
            .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange.id))
            .where(and(samePlaces(workspaceChange, group), held)),
        ),
      { bulk: true },
    );
    const reached = placedBy(group);
    const byPlace = new Map<string, HeldEvidence[]>();
    const hold = (place: PlacedPath, row: HeldEvidence) => {
      const standing = byPlace.get(place.path);
      if (standing === undefined) byPlace.set(place.path, [row]);
      else standing.push(row);
    };
    for (const { archivedAt, checkout, ...row } of typed) {
      const place = reached({ checkout, path: row.path });
      if (place !== undefined) hold(place, { ...row, ended: retired(archivedAt), unresolved: false });
    }
    const digests = [...byPlace.values()]
      .flat()
      .flatMap((row) => [row.beforeHash, row.afterHash].filter((digest): digest is string => digest !== null));
    const texts = digests.length === 0 ? new Map<string, string>() : yield* versionTexts(units, store, digests);
    const answered = new Map<string, readonly OrderedChange[]>();
    for (const place of group) {
      const rows = byPlace.get(place.path) ?? [];
      rows.sort((left, right) => left.at.getTime() - right.at.getTime() || left.id.localeCompare(right.id));
      answered.set(
        place.path,
        rows.map(({ at, ...row }) => versioned(texts, { ...row, at: at.getTime() })),
      );
    }
    return answered;
  });
});

export type StandingEvidence = {
  readonly id: string;
  readonly path: string;
  readonly threadId: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly unresolved: boolean;
};

export const evidenceInGroups = Effect.fn('WorkspaceChangeLog.evidenceInGroups')(function* <A, E>(
  units: MachineUnits['Service'],
  store: StoreShape,
  places: readonly PlacedPath[],
  use: (evidence: ReadonlyMap<string, readonly StandingEvidence[]>) => Effect.Effect<readonly A[], E>,
) {
  const taken: A[] = [];
  const asked = [...new Map(places.map((place) => [place.path, place] as const)).values()];
  for (const group of chunk(asked, EVIDENCE_GROUP)) {
    const rows = yield* units.read((unit) =>
      unit.run(
        store.db
          .select({
            id: workspaceChange.id,
            checkout: workspaceChange.checkout,
            path: workspaceChange.path,
            threadId: workspaceChange.holder,
            beforeHash: workspaceChange.beforeHash,
            afterHash: workspaceChange.afterHash,
          })
          .from(workspaceChange)
          .where(and(samePlaces(workspaceChange, group), held))
          .orderBy(workspaceChange.path, workspaceChange.at, workspaceChange.id),
      ),
    );
    const reached = placedBy(group);
    const evidence = new Map<string, StandingEvidence[]>(group.map((place) => [place.path, []]));
    for (const { checkout, ...row } of rows) {
      const place = reached({ checkout, path: row.path });
      if (place !== undefined) evidence.get(place.path)!.push({ ...row, unresolved: false });
    }
    taken.push(...(yield* use(evidence)));
  }
  return taken;
});

export const evidenceOfPath = Effect.fn('WorkspaceChangeLog.evidenceOfPath')(function (
  units: MachineUnits['Service'],
  store: StoreShape,
  place: PlacedPath,
): Effect.Effect<readonly OrderedChange[], StoreFailure> {
  return Effect.map(evidenceOfGroup(units, store, [place]), (answered) => answered.get(place.path) ?? []);
});
