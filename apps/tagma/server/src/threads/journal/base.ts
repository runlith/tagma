import { Data, Effect } from 'effect';
import { and, asc, between, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { MachineStore, type StoreDb, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { prepareFor } from '../../platform/store/queries.js';
import { threadBase, threadEvent } from '../store/journal.js';
import { threadEntry } from '../store/kernel.js';

export type BaseLayer = typeof threadBase.$inferSelect;

export type Arm = { readonly layer: BaseLayer | null; readonly where: SQL };

const shadowed = (threadId: string, above: readonly BaseLayer[]): SQL =>
  sql.join(
    [
      sql`not exists (select 1 from ${threadEntry} as o where o.thread_id = ${threadId} and o.ord = ${threadEntry.ord})`,
      ...above.map(
        (layer) =>
          sql`not exists (select 1 from ${threadEntry} as o where o.thread_id = ${layer.sourceId} and o.ord = ${threadEntry.ord}
            and o.ord between ${layer.lowOrd} and ${layer.highOrd})`,
      ),
    ],
    sql` and `,
  );

const carried = (layer: BaseLayer): SQL[] => [
  eq(threadEntry.threadId, layer.sourceId),
  between(threadEntry.ord, layer.lowOrd, layer.highOrd),
  ...(layer.prompts === 'dropped' ? [sql`${threadEntry.type} <> 'system-prompt'`] : []),
  ...(layer.hidden.length === 0
    ? []
    : [
        sql`(${threadEntry.type} = 'system-prompt' or ${threadEntry.runId} is null
          or ${threadEntry.runId} not in (select value from json_each(${JSON.stringify(layer.hidden)})))`,
      ]),
];

export const armsOf = (threadId: string, layers: readonly BaseLayer[]): readonly Arm[] => [
  { layer: null, where: eq(threadEntry.threadId, threadId) },
  ...layers.map((layer, at) => ({ layer, where: and(...carried(layer), shadowed(threadId, layers.slice(at + 1)))! })),
];

const baseReads = prepareFor((db: StoreDb<'machine'>) => ({
  layers: db
    .select()
    .from(threadBase)
    .where(eq(threadBase.threadId, sql.placeholder('threadId')))
    .orderBy(asc(threadBase.depth))
    .prepare(),
  referrers: db
    .select()
    .from(threadBase)
    .where(eq(threadBase.sourceId, sql.placeholder('sourceId')))
    .orderBy(asc(threadBase.threadId), asc(threadBase.depth))
    .prepare(),
}));

export const layersOf = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  threadId: string,
): Effect.Effect<readonly BaseLayer[], StoreFailure> => unit.run(baseReads(db).layers.all({ threadId }));

export const referrersOf = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  sourceId: string,
): Effect.Effect<readonly BaseLayer[], StoreFailure> => unit.run(baseReads(db).referrers.all({ sourceId }));

export const sourcesOutside = (db: StoreDb<'machine'>, unit: Unit<'machine'>, threadIds: readonly string[]) =>
  Effect.map(
    unit.run(
      db
        .selectDistinct({ sourceId: threadBase.sourceId })
        .from(threadBase)
        .where(inArray(threadBase.threadId, [...threadIds])),
    ),
    (rows) => rows.map((row) => row.sourceId).filter((sourceId) => !threadIds.includes(sourceId)),
  );

export const unfiledHeirs = (db: StoreDb<'machine'>, unit: Unit<'machine'>, sourceIds: readonly string[]) =>
  Effect.map(
    unit.run(
      db
        .selectDistinct({ threadId: threadBase.threadId })
        .from(threadBase)
        .where(and(inArray(threadBase.sourceId, [...sourceIds]), eq(threadBase.unfiled, true))),
    ),
    (rows) => rows.map((row) => row.threadId),
  );

export const unfiled = (db: StoreDb<'machine'>, threadId: string) =>
  Effect.map(
    db
      .select({ depth: threadBase.depth })
      .from(threadBase)
      .where(and(eq(threadBase.threadId, threadId), eq(threadBase.unfiled, true)))
      .limit(1)
      .get(),
    (row) => row !== undefined,
  );

export const filed = (store: MachineStore['Service'], threadId: string) =>
  store.transaction(writes('ThreadRollout.filed', [threadBase]), (unit) =>
    Effect.asVoid(
      unit.run(
        store.db
          .update(threadBase)
          .set({ unfiled: false })
          .where(and(eq(threadBase.threadId, threadId), eq(threadBase.unfiled, true))),
      ),
    ),
  );

export const live = sql`(${threadBase.afterPosition} < ${threadBase.throughPosition} or ${threadBase.lowOrd} <= ${threadBase.highOrd})`;

export const referencedThrough = (db: StoreDb<'machine'>, sourceId: string) =>
  Effect.map(
    db
      .select({ through: sql<number | null>`max(${threadBase.throughPosition})` })
      .from(threadBase)
      .where(and(eq(threadBase.sourceId, sourceId), live))
      .get(),
    (row) => row?.through ?? null,
  );

export const livingReaders = (db: StoreDb<'machine'>, sourceId: string) =>
  db
    .select()
    .from(threadBase)
    .where(and(eq(threadBase.sourceId, sourceId), live))
    .orderBy(asc(threadBase.threadId), asc(threadBase.depth));

export const referenced = (db: StoreDb<'machine'>, sourceId: string) =>
  Effect.map(
    db.select({ depth: threadBase.depth }).from(threadBase).where(eq(threadBase.sourceId, sourceId)).limit(1).get(),
    (row) => row !== undefined,
  );

export const remnant = (db: StoreDb<'machine'>, threadId: string) =>
  Effect.map(
    db.get<{ held: number }>(sql`select exists (select 1 from ${threadEvent} where ${threadEvent.threadId} = ${threadId})
      or exists (select 1 from ${threadEntry} where ${threadEntry.threadId} = ${threadId}) as held`),
    (row) => row?.held === 1,
  );

export const based = (db: StoreDb<'machine'>, threadId: string) =>
  Effect.map(
    db
      .select({ depth: threadBase.depth })
      .from(threadBase)
      .where(and(eq(threadBase.threadId, threadId), live))
      .limit(1)
      .get(),
    (row) => row !== undefined,
  );

export const emptied = (db: StoreDb<'machine'>, unit: Unit<'machine'>, threadId: string) =>
  Effect.asVoid(
    unit.run(
      db
        .update(threadBase)
        .set({ lowOrd: 1, highOrd: 0, afterPosition: sql`${threadBase.throughPosition}`, unfiled: false })
        .where(eq(threadBase.threadId, threadId)),
    ),
  );

export type LayerSources = (threadId: string, unit?: Unit<'machine'>) => Effect.Effect<readonly string[], StoreFailure>;

export type BaseReach = {
  readonly sources: LayerSources;
  readonly referenced: (threadId: string) => Effect.Effect<boolean, StoreFailure>;
};

export const makeBaseReach = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return {
    sources: (threadId, unit) => {
      const read = (tx: Unit<'machine'>) =>
        Effect.map(layersOf(db, tx, threadId), (layers) => [...new Set(layers.map((layer) => layer.sourceId).reverse())]);
      return unit === undefined ? units.read(read) : read(unit);
    },
    referenced: (threadId) => units.read((unit) => Effect.map(referrersOf(db, unit, threadId), (layers) => layers.length > 0)),
  } satisfies BaseReach;
});

export class ThreadFilesReferenced extends Data.TaggedError('ThreadFilesReferenced')<{ readonly message: string }> {
  constructor(threadId: string) {
    super({ message: `Thread ${threadId} is gone, and a branch still reads the files of its prefix.` });
  }
}

type Place = AnySQLiteColumn | SQL;

export type EventArm = Arm & { readonly on: (thread: Place, position: Place) => SQL };

const eventArm = (layer: BaseLayer | null, on: EventArm['on']): EventArm => ({
  layer,
  on,
  where: on(threadEvent.threadId, threadEvent.position),
});

export const eventArmsOf = (threadId: string, layers: readonly BaseLayer[]): readonly [EventArm, ...EventArm[]] => {
  const carrying = layers.filter((layer) => layer.afterPosition < layer.throughPosition);
  return [
    eventArm(null, (thread) => sql`${thread} = ${threadId}`),
    ...carrying.map((layer, at) =>
      eventArm(
        layer,
        (thread, position) =>
          sql`${thread} = ${layer.sourceId} and ${position} > ${layer.afterPosition} and ${position} <= ${layer.throughPosition}
            and not exists (select 1 from ${threadEvent} as o where o.thread_id = ${threadId} and o.position = ${position})${sql.join(
              carrying.slice(at + 1).map(
                (upper) =>
                  sql` and not exists (select 1 from ${threadEvent} as o where o.thread_id = ${upper.sourceId} and o.position = ${position}
                      and o.position > ${upper.afterPosition} and o.position <= ${upper.throughPosition})`,
              ),
              sql``,
            )}`,
      ),
    ),
  ];
};

type Mergeable<Q> = { readonly unionAll: (arm: Q) => Q };

type Ordered<Q> = Mergeable<Q> & { readonly orderBy: (order: SQL) => Q };

export const merged = <Q extends Mergeable<Q>>(arms: readonly [EventArm, ...EventArm[]], select: (where: SQL) => Q): Q => {
  const [own, ...inherited] = arms;
  return inherited.reduce((union, arm) => union.unionAll(select(arm.where)), select(own.where));
};

export const byPosition = <Q extends Ordered<Q>>(arms: readonly [EventArm, ...EventArm[]], select: (where: SQL) => Q): Q =>
  merged(arms, select).orderBy(asc(threadEvent.position));

export const journalHead = (threadId: SQL): SQL => sql`max(
  coalesce((select max(${threadEvent.position}) from ${threadEvent} where ${threadEvent.threadId} = ${threadId}), 0),
  coalesce((select max(${threadBase.throughPosition}) from ${threadBase} where ${threadBase.threadId} = ${threadId}), 0))`;
