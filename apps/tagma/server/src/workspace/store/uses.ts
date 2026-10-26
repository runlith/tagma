import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { rootUse, rootUseHold } from './tables.js';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { RootUse, type UseMode } from '../contract/wire/uses.js';
import { UseId, type RootId } from '../contract/wire/ids.js';
import { RootStorageFailed } from './rootRegistry.js';

const decodeUse = Schema.decodeUnknownEffect(RootUse);

const record = Effect.fn('RootUseStore.record')(
  (row: typeof rootUse.$inferSelect, holds: readonly (typeof rootUseHold.$inferSelect)[]) =>
    decodeUse({
      useId: row.useId,
      resource: { namespaceId: row.namespaceId, path: row.path },
      consumer: { kind: row.consumerKind, id: row.consumerId },
      mode: row.mode,
      state: row.state,
      roots: holds.map((hold) => ({ rootId: hold.rootId, locationRevision: hold.locationRevision })),
    }),
  (work, row) => Effect.mapError(work, (cause) => new RootStorageFailed({ key: row.useId, cause })),
);

export type RootUseStore = ReturnType<typeof makeRootUseStore>;

export const makeRootUseStore = ({ db }: { readonly db: StoreDb<'machine'> }) => {
  const byId = Effect.fn('RootUseStore.byId')(function* (useId: UseId, unit: Unit<'machine'>) {
    return (yield* read([useId], unit))[0] ?? null;
  });

  const holders = Effect.fn('RootUseStore.holders')(function* (rootIds: readonly RootId[], unit: Unit<'machine'>, mode?: UseMode) {
    if (rootIds.length === 0) return [];
    const rows = yield* unit.run(
      db
        .select({ useId: rootUse.useId })
        .from(rootUse)
        .where(
          and(
            sql`${rootUse.state} = 'held'`,
            mode === undefined ? undefined : eq(rootUse.mode, mode),
            exists(
              db
                .select({ held: sql`1` })
                .from(rootUseHold)
                .where(and(eq(rootUseHold.useId, rootUse.useId), inArray(rootUseHold.rootId, rootIds))),
            ),
          ),
        )
        .all(),
    );
    return yield* read(
      rows.map((row) => UseId.make(row.useId)),
      unit,
    );
  });

  const holdStep = Effect.fn('RootUseStore.hold')(function* (use: RootUse, unit: WriteUnit<'machine'>) {
    yield* unit.run(
      db.insert(rootUse).values({
        useId: use.useId,
        namespaceId: use.resource.namespaceId,
        path: use.resource.path,
        consumerKind: use.consumer.kind,
        consumerId: use.consumer.id,
        mode: use.mode,
        state: use.state,
      }),
    );
    if (use.roots.length === 0) return;
    yield* unit.run(
      db.insert(rootUseHold).values(
        use.roots.map((binding) => ({
          useId: use.useId,
          rootId: binding.rootId,
          locationRevision: binding.locationRevision,
        })),
      ),
    );
  });

  const release = Effect.fn('RootUseStore.release')(function* (useId: UseId, unit: WriteUnit<'machine'>) {
    yield* unit.run(db.update(rootUse).set({ state: 'released' }).where(eq(rootUse.useId, useId)));
  });

  const read = Effect.fn('RootUseStore.read')(function* (useIds: readonly UseId[], unit: Unit<'machine'>) {
    if (useIds.length === 0) return [];
    const rows = yield* unit.run(db.select().from(rootUse).where(inArray(rootUse.useId, useIds)).all());
    const holds = yield* unit.run(
      db.select().from(rootUseHold).where(inArray(rootUseHold.useId, useIds)).orderBy(asc(rootUseHold.rootId)).all(),
    );
    const byUse = new Map<string, (typeof rootUseHold.$inferSelect)[]>();
    for (const hold of holds) {
      const held = byUse.get(hold.useId);
      if (held === undefined) byUse.set(hold.useId, [hold]);
      else held.push(hold);
    }
    return yield* Effect.forEach(rows, (row) => record(row, byUse.get(row.useId) ?? []));
  });

  return { byId, holders, hold: holdStep, release };
};
