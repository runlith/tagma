import { Effect } from 'effect';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { threadEntry } from '../../threads/store/kernel.js';
import { threadBase } from '../../threads/store/journal.js';
import { type Arm, armsOf, layersOf, referrersOf } from '../../threads/journal/base.js';

const KEPT_ROWS = rowsPerStatement(6);
const ARM_BINDS = rowsPerStatement(1) - 16;

export type ViewRow = {
  readonly ord: number;
  readonly entryId: string;
  readonly runId: string | null;
  readonly type: string;
  readonly entry: ThreadTranscriptEntry;
};

const columns = {
  ord: threadEntry.ord,
  entryId: threadEntry.entryId,
  runId: threadEntry.runId,
  type: threadEntry.type,
  entry: threadEntry.entry,
};

const inheritedFirst = (arms: readonly Arm[]): readonly Arm[] => [...arms.slice(1), arms[0]!];

export const makeLayeredEntries = (db: StoreDb<'machine'>) => {
  const arms = (unit: Unit<'machine'>, threadId: string) => Effect.map(layersOf(db, unit, threadId), (layers) => armsOf(threadId, layers));

  const rows = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string, where?: SQL) {
    const found = new Map<number, ViewRow>();
    for (const arm of inheritedFirst(yield* arms(unit, threadId))) {
      for (const row of yield* unit.run(db.select(columns).from(threadEntry).where(and(arm.where, where)).orderBy(asc(threadEntry.ord)))) {
        if (arm.layer === null || !found.has(row.ord)) found.set(row.ord, row);
      }
    }
    return [...found.values()].sort((left, right) => left.ord - right.ord);
  });

  const newest = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string, where: SQL | undefined, limit: number) {
    const found: { readonly ord: number; readonly entryId: string; readonly size: number; readonly type: string }[] = [];
    for (const arm of inheritedFirst(yield* arms(unit, threadId))) {
      found.push(
        ...(yield* unit.run(
          db
            .select({
              ord: threadEntry.ord,
              entryId: threadEntry.entryId,
              size: sql<number>`length(${threadEntry.entry})`,
              type: threadEntry.type,
            })
            .from(threadEntry)
            .where(and(arm.where, where))
            .orderBy(desc(threadEntry.ord))
            .limit(limit),
        )),
      );
    }
    const ords = new Set<number>();
    return found
      .sort((left, right) => right.ord - left.ord)
      .filter((row) => !ords.has(row.ord) && ords.add(row.ord) !== undefined)
      .slice(0, limit);
  });

  const any = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string, where: SQL) {
    for (const arm of yield* arms(unit, threadId)) {
      const row = yield* unit.run(db.select({ ord: threadEntry.ord }).from(threadEntry).where(and(arm.where, where)).limit(1).get());
      if (row !== undefined) return true;
    }
    return false;
  });

  const edge = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string) {
    const [span] = yield* unit.run(
      db.all<{ low: number | null; high: number | null }>(sql`select min(low) as low, max(high) as high from (
        select min(${threadEntry.ord}) as low, max(${threadEntry.ord}) as high from ${threadEntry} where ${threadEntry.threadId} = ${threadId}
        union all
        select min(${threadBase.lowOrd}), max(${threadBase.highOrd}) from ${threadBase}
          where (${threadBase.threadId} = ${threadId} or ${threadBase.sourceId} = ${threadId}) and ${threadBase.lowOrd} <= ${threadBase.highOrd})`),
    );
    return { low: span?.low ?? 0, high: span?.high ?? -1 };
  });

  const keep = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string, held: readonly ViewRow[]) {
    for (let at = 0; at < held.length; at += KEPT_ROWS) {
      yield* unit.run(
        db
          .insert(threadEntry)
          .values(
            held
              .slice(at, at + KEPT_ROWS)
              .map((row) => ({ threadId, ord: row.ord, entryId: row.entryId, runId: row.runId, type: row.type, entry: row.entry })),
          )
          .onConflictDoNothing(),
      );
    }
  });

  const preserve = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string, ords: readonly number[]) {
    if (ords.length === 0) return;
    const referrers = yield* referrersOf(db, unit, threadId);
    const owners = new Map<string, number[]>();
    for (const layer of referrers) {
      const covered = ords.filter((ord) => ord >= layer.lowOrd && ord <= layer.highOrd);
      if (covered.length > 0) owners.set(layer.threadId, [...(owners.get(layer.threadId) ?? []), ...covered]);
    }
    for (const [owner, covered] of owners) {
      yield* keep(unit, owner, yield* inheritedWhere(unit, owner, threadEntry.ord, [...new Set(covered)]));
    }
  });

  const inheritedWhere = Effect.fnUntraced(function* <V extends string | number>(
    unit: Unit<'machine'>,
    threadId: string,
    column: typeof threadEntry.ord | typeof threadEntry.entryId,
    values: readonly V[],
  ) {
    const held: ViewRow[] = [];
    if (values.length === 0) return held;
    const layered = (yield* arms(unit, threadId)).slice(1);
    const per = Math.max(1, ARM_BINDS - 4 * layered.length);
    for (const arm of layered) {
      for (let at = 0; at < values.length; at += per) {
        const chunk = values.slice(at, at + per) as never[];
        held.push(
          ...(yield* unit.run(
            db
              .select(columns)
              .from(threadEntry)
              .where(and(arm.where, inArray(column, chunk))),
          )),
        );
      }
    }
    return held;
  });

  const inherited = (unit: Unit<'machine'>, threadId: string, entryIds: readonly string[]) =>
    inheritedWhere(unit, threadId, threadEntry.entryId, entryIds);

  const hide = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string, runIds: readonly string[]) {
    if (runIds.length === 0) return;
    for (const layer of yield* layersOf(db, unit, threadId)) {
      const hidden = [...new Set([...layer.hidden, ...runIds])];
      yield* unit.run(
        db
          .update(threadBase)
          .set({ hidden })
          .where(and(eq(threadBase.threadId, threadId), eq(threadBase.depth, layer.depth))),
      );
    }
  });

  return { arms, rows, newest, any, edge, keep, preserve, inherited, hide };
};

export type LayeredEntries = ReturnType<typeof makeLayeredEntries>;
