import { and, asc, eq, inArray } from 'drizzle-orm';
import { Clock, Effect, Schema } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { preparedTree } from './tables.js';
import {
  PreparationReceipt,
  PreparedTreeManifest,
  type PreparedTreeRecord,
  type PreparedTreeState,
} from '../contract/wire/preparedTree.js';
import { stored, trusted } from '../../platform/store/crossing.js';

const decodeManifest = Schema.decodeUnknownResult(PreparedTreeManifest);
const decodeReceipt = Schema.decodeUnknownResult(PreparationReceipt);

function recordOf(row: typeof preparedTree.$inferSelect): PreparedTreeRecord {
  const receipt = decodeReceipt(row.receipt);
  if (receipt._tag !== 'Success') {
    throw new Error(`The receipt of prepared tree ${row.id} cannot be read — ${receipt.failure.message}`);
  }
  if (row.manifest === null) return { ...row, receipt: receipt.success, manifest: null };
  const manifest = decodeManifest(row.manifest);
  if (manifest._tag !== 'Success') {
    throw new Error(`The manifest of prepared tree ${row.id} cannot be read — ${manifest.failure.message}`);
  }
  return { ...row, receipt: receipt.success, manifest: manifest.success };
}

export type PreparedTreeStore = {
  open(
    values: {
      readonly id: string;
      readonly projectId: number | null;
      readonly ownerId: string;
      readonly receipt: PreparedTreeRecord['receipt'];
    },
    tx?: Unit<'machine'>,
  ): Effect.Effect<PreparedTreeRecord, ThreadStorageFailed>;
  sealed(id: string, archivePath: string, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  ready(id: string, manifest: PreparedTreeManifest, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  failed(id: string, reason: string, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  cleaned(id: string, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  cleanupFailed(id: string, reason: string, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  releasing(id: string, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  failedRelease(id: string, reason: string, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  released(id: string, tx?: Unit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  byId(id: string, tx?: Unit<'machine'>): Effect.Effect<PreparedTreeRecord | null, ThreadStorageFailed>;
  standing(tx?: Unit<'machine'>): Effect.Effect<readonly PreparedTreeRecord[], ThreadStorageFailed>;
};

export const makePreparedTreeStore = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const transition = (
    id: string,
    from: readonly PreparedTreeState[],
    values: Partial<typeof preparedTree.$inferInsert>,
    tx: Unit<'machine'> | undefined,
    call: string,
  ) => {
    const write = Effect.fnUntraced(function* (unit: Unit<'machine'>) {
      const rows = yield* unit.run(
        db
          .update(preparedTree)
          .set({ ...values, updatedAt: new Date(yield* Clock.currentTimeMillis) })
          .where(and(eq(preparedTree.id, id), inArray(preparedTree.state, [...from])))
          .returning({ id: preparedTree.id })
          .all(),
      );
      return rows.length > 0;
    });
    return stored(call)(tx ? write(tx) : units.write(writes('PreparedTreeStore.transition', [preparedTree]), write));
  };

  const store: PreparedTreeStore = {
    open: (values, tx) => {
      const write = Effect.fnUntraced(function* (unit: Unit<'machine'>) {
        const now = new Date(yield* Clock.currentTimeMillis);
        const row = yield* unit.run(
          db
            .insert(preparedTree)
            .values({ ...values, createdAt: now, updatedAt: now })
            .returning()
            .get(),
        );
        if (!row) return yield* Effect.die(new Error('The prepared tree table returned no row for an insert.'));
        return yield* trusted('open', () => recordOf(row));
      });
      return stored('open')(tx ? write(tx) : units.write(writes('PreparedTreeStore.open', [preparedTree]), write));
    },

    sealed: (id, archivePath, tx) => transition(id, ['building'], { archivePath }, tx, 'sealed'),

    ready: (id, manifest, tx) => transition(id, ['building'], { state: 'ready', manifest, failureReason: null }, tx, 'ready'),

    failed: (id, reason, tx) => transition(id, ['building', 'ready'], { state: 'failed', failureReason: reason }, tx, 'failed'),

    cleaned: (id, tx) =>
      transition(
        id,
        ['building', 'ready', 'failed', 'releasing', 'released'],
        { resourcesReleased: true, cleanupReason: null },
        tx,
        'cleaned',
      ),

    cleanupFailed: (id, reason, tx) =>
      transition(id, ['building', 'ready', 'failed', 'releasing', 'released'], { cleanupReason: reason }, tx, 'cleanupFailed'),

    releasing: (id, tx) => transition(id, ['building', 'ready', 'failed', 'releasing'], { state: 'releasing' }, tx, 'releasing'),

    failedRelease: (id, reason, tx) => transition(id, ['releasing'], { failureReason: reason }, tx, 'failedRelease'),

    released: (id, tx) => transition(id, ['releasing'], { state: 'released', archivePath: null }, tx, 'released'),

    byId: (id, tx) => {
      const read = (unit: Unit<'machine'>) =>
        Effect.flatMap(unit.run(db.select().from(preparedTree).where(eq(preparedTree.id, id)).get()), (row) =>
          row ? trusted('byId', () => recordOf(row)) : Effect.succeed(null),
        );
      return stored('byId')(tx ? read(tx) : units.read(read));
    },

    standing: (tx) => {
      const where = inArray(preparedTree.state, ['building', 'ready', 'failed', 'releasing']);
      const read = (unit: Unit<'machine'>) =>
        Effect.flatMap(unit.run(db.select().from(preparedTree).where(where).orderBy(asc(preparedTree.createdAt)).all()), (rows) =>
          trusted('standing', () => rows.map(recordOf)),
        );
      return stored('standing')(tx ? read(tx) : units.read(read));
    },
  };
  return store;
});
