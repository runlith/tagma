import { and, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { threadRecord } from './store/table.js';
import type { StoreDb, StoreFailure } from '../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../platform/contract/service/units.js';
import type { TitleNaming, TitleProvenance } from './contract/wire/title.js';

const titleColumns = {
  title: threadRecord.title,
  origin: threadRecord.titleOrigin,
  revision: threadRecord.titleRevision,
};

export const titleOf = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string) =>
  unit.run(db.select(titleColumns).from(threadRecord).where(eq(threadRecord.id, id)).get());

export const setTitle = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, id: string, title: string, provenance: TitleProvenance) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set({ title, titleOrigin: provenance, titleRevision: sql`${threadRecord.titleRevision} + 1` })
        .where(eq(threadRecord.id, id))
        .returning({ revision: threadRecord.titleRevision }),
    ),
    (rows) => rows[0]?.revision,
  );

export const nameTitle = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  id: string,
  title: string,
  expectedRevision: number,
): Effect.fn.Return<TitleNaming, StoreFailure> {
  const before = (yield* titleOf(db, unit, id)) ?? null;
  if (before === null || before.revision !== expectedRevision) return { outcome: 'superseded', before, after: before };
  if (before.title === title) return { outcome: 'same-text', before, after: before };
  const rows = yield* unit.run(
    db
      .update(threadRecord)
      .set({ title, titleOrigin: 'generated', titleRevision: sql`${threadRecord.titleRevision} + 1` })
      .where(and(eq(threadRecord.id, id), eq(threadRecord.titleRevision, expectedRevision)))
      .returning(titleColumns),
  );
  const after = rows[0];
  return after === undefined
    ? { outcome: 'superseded', before, after: (yield* titleOf(db, unit, id)) ?? null }
    : { outcome: 'written', before, after };
});

export const adoptTitle = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  id: string,
  title: string,
  expectedRevision: number,
  provenances: readonly TitleProvenance[],
) {
  if (title.trim() === '' || provenances.length === 0) return undefined;
  const rows = yield* unit.run(
    db
      .update(threadRecord)
      .set({ title, titleOrigin: 'harness', titleRevision: sql`${threadRecord.titleRevision} + 1` })
      .where(
        and(
          eq(threadRecord.id, id),
          eq(threadRecord.titleRevision, expectedRevision),
          inArray(threadRecord.titleOrigin, [...provenances]),
          sql`not (${threadRecord.titleOrigin} = 'harness' and ${threadRecord.title} = ${title})`,
        ),
      )
      .returning({ revision: threadRecord.titleRevision }),
  );
  return rows[0]?.revision;
});

export const claimTitleInput = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, id: string, input: string) =>
  Effect.map(
    unit.run(
      db
        .update(threadRecord)
        .set({ titleAskedInput: input })
        .where(
          and(
            eq(threadRecord.id, id),
            eq(threadRecord.titleOrigin, 'random'),
            sql`(${threadRecord.titleAskedInput} is null or ${threadRecord.titleAskedInput} <> ${input})`,
          ),
        )
        .returning(titleColumns),
    ),
    (rows) => rows[0],
  );
