import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { Clock, Effect, Schema } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { sandbox } from './tables.js';
import { SandboxManifest, GuestReceipt, type SandboxRecord, type SandboxState } from '../contract/wire/sandbox.js';
import { stored, trusted } from '../../platform/store/crossing.js';

const decodeManifest = Schema.decodeUnknownResult(SandboxManifest);
const decodeRuntime = Schema.decodeUnknownResult(GuestReceipt);

function recordOf(row: typeof sandbox.$inferSelect): SandboxRecord {
  const runtime = decodeRuntime(row.runtime);
  if (runtime._tag !== 'Success') {
    throw new Error(`The runtime receipt of sandbox ${row.id} cannot be read — ${runtime.failure.message}`);
  }
  if (row.manifest === null) return { ...row, runtime: runtime.success, manifest: null };
  const manifest = decodeManifest(row.manifest);
  if (manifest._tag !== 'Success') {
    throw new Error(`The manifest of sandbox ${row.id} cannot be read — ${manifest.failure.message}`);
  }
  return { ...row, runtime: runtime.success, manifest: manifest.success };
}

export type SandboxStore = {
  watch(watcher: (id: string) => void): () => void;
  live(projectId: number): Effect.Effect<readonly SandboxRecord[], ThreadStorageFailed>;
  open(
    values: {
      readonly id: string;
      readonly projectId: number | null;
      readonly ownerId: string;
      readonly runtime: SandboxRecord['runtime'];
    },
    tx?: Unit<'machine'>,
  ): Effect.Effect<SandboxRecord, ThreadStorageFailed>;
  prepared(id: string, manifest: SandboxRecord['manifest'], tx?: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  failed(id: string, reason: string, tx?: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  releasing(id: string, tx?: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  releasingUnbound(id: string, tx?: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  exported(id: string, path: string, tx?: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  failedRelease(id: string, reason: string, tx?: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  released(id: string, tx?: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  byId(id: string, tx?: Unit<'machine'>): Effect.Effect<SandboxRecord | null, ThreadStorageFailed>;
  ofThread(threadId: string, tx?: Unit<'machine'>): Effect.Effect<SandboxRecord | null, ThreadStorageFailed>;
  bind(id: string, threadId: string, tx: WriteUnit<'machine'>): Effect.Effect<boolean, ThreadStorageFailed>;
  standing(tx?: Unit<'machine'>): Effect.Effect<readonly SandboxRecord[], ThreadStorageFailed>;
};

export const makeSandboxStore = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const watchers = new Set<(id: string) => void>();

  const moved = (unit: WriteUnit<'machine'>, id: string, took: boolean): Effect.Effect<boolean> => {
    if (!took) return Effect.succeed(false);
    return Effect.as(
      unit.afterCommit(
        Effect.sync(() => {
          for (const watcher of watchers) watcher(id);
        }),
      ),
      true,
    );
  };

  const many = (call: string, where: SQL, tx?: Unit<'machine'>) => {
    const read = (unit: Unit<'machine'>) =>
      Effect.flatMap(unit.run(db.select().from(sandbox).where(where).orderBy(asc(sandbox.createdAt)).all()), (rows) =>
        trusted(call, () => rows.map(recordOf)),
      );
    return stored(call)(tx ? read(tx) : units.read(read));
  };

  const one = (call: string, where: SQL, tx?: Unit<'machine'>) => {
    const read = (unit: Unit<'machine'>) =>
      Effect.flatMap(unit.run(db.select().from(sandbox).where(where).get()), (row) =>
        row ? trusted(call, () => recordOf(row)) : Effect.succeed(null),
      );
    return stored(call)(tx ? read(tx) : units.read(read));
  };

  const transition = (
    id: string,
    from: readonly SandboxState[],
    values: Partial<typeof sandbox.$inferInsert>,
    tx: WriteUnit<'machine'> | undefined,
    call: string,
  ) => {
    const write = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>) {
      const rows = yield* unit.run(
        db
          .update(sandbox)
          .set({ ...values, updatedAt: new Date(yield* Clock.currentTimeMillis) })
          .where(and(eq(sandbox.id, id), inArray(sandbox.state, [...from])))
          .returning({ id: sandbox.id })
          .all(),
      );
      return yield* moved(unit, id, rows.length > 0);
    });
    return stored(call)(tx ? write(tx) : units.write(writes('SandboxStore.transition', [sandbox]), write));
  };

  const store: SandboxStore = {
    watch: (watcher) => {
      watchers.add(watcher);
      return () => void watchers.delete(watcher);
    },

    live: (projectId) =>
      many(
        'live',
        and(eq(sandbox.projectId, projectId), isNotNull(sandbox.boundThreadId), inArray(sandbox.state, ['preparing', 'prepared'])) as SQL,
      ),

    open: (values, tx) => {
      const write = Effect.fnUntraced(function* (unit: Unit<'machine'>) {
        const now = new Date(yield* Clock.currentTimeMillis);
        const row = yield* unit.run(
          db
            .insert(sandbox)
            .values({ ...values, createdAt: now, updatedAt: now })
            .returning()
            .get(),
        );
        if (!row) return yield* Effect.die(new Error('The sandbox table returned no row for an insert.'));
        return yield* trusted('open', () => recordOf(row));
      });
      return stored('open')(tx ? write(tx) : units.write(writes('SandboxStore.open', [sandbox]), write));
    },

    prepared: (id, manifest, tx) => transition(id, ['preparing'], { state: 'prepared', manifest, failureReason: null }, tx, 'prepared'),

    failed: (id, reason, tx) => transition(id, ['preparing', 'prepared'], { state: 'failed', failureReason: reason }, tx, 'failed'),

    releasing: (id, tx) =>
      transition(id, ['preparing', 'prepared', 'failed', 'releasing'], { state: 'releasing', boundThreadId: null }, tx, 'releasing'),

    releasingUnbound: (id, tx) => {
      const write = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>) {
        const rows = yield* unit.run(
          db
            .update(sandbox)
            .set({ state: 'releasing', updatedAt: new Date(yield* Clock.currentTimeMillis) })
            .where(
              and(
                eq(sandbox.id, id),
                isNull(sandbox.boundThreadId),
                inArray(sandbox.state, ['preparing', 'prepared', 'failed', 'releasing']),
              ),
            )
            .returning({ id: sandbox.id })
            .all(),
        );
        return rows.length > 0;
      });
      return stored('releasingUnbound')(tx ? write(tx) : units.write(writes('SandboxStore.releasingUnbound', [sandbox]), write));
    },

    exported: (id, path, tx) => transition(id, ['releasing'], { exportPath: path }, tx, 'exported'),

    failedRelease: (id, reason, tx) => transition(id, ['releasing'], { failureReason: reason }, tx, 'failedRelease'),

    released: (id, tx) => transition(id, ['releasing'], { state: 'released', boundThreadId: null }, tx, 'released'),

    byId: (id, tx) => one('byId', eq(sandbox.id, id), tx),

    ofThread: (threadId, tx) => one('ofThread', eq(sandbox.boundThreadId, threadId), tx),

    bind: Effect.fnUntraced(function* (id, threadId, tx) {
      const rows = yield* stored('bind')(
        tx.run(
          db
            .update(sandbox)
            .set({ boundThreadId: threadId, updatedAt: new Date(yield* Clock.currentTimeMillis) })
            .where(
              and(
                eq(sandbox.id, id),
                eq(sandbox.state, 'prepared'),
                or(isNull(sandbox.boundThreadId), eq(sandbox.boundThreadId, threadId)),
              ),
            )
            .returning({ id: sandbox.id })
            .all(),
        ),
      );
      return yield* moved(tx, id, rows.length > 0);
    }),

    standing: (tx) => many('standing', inArray(sandbox.state, ['preparing', 'prepared', 'releasing', 'failed']), tx),
  };
  return store;
});
