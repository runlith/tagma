import { Clock, Effect, Queue, Schedule } from 'effect';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { sql } from 'drizzle-orm';
import { stat } from 'node:fs/promises';
import type { Store, StoreFailure } from '../contract/service/store.js';
import { relaxedWrites } from '../contract/service/durability.js';
import type { StoreSize, VacuumVerdict } from '../contract/wire/vacuum.js';

const INCREMENTAL = 2;

const PORTION_MS = 25;

const RECLAIM = relaxedWrites('Store.reclaim', []);

const RETRY = Schedule.spaced('1 minute');

const sizeOf = Effect.fn('Store.sizeOf')(function* (db: EffectSQLiteBunDatabase): Effect.fn.Return<StoreSize, StoreFailure> {
  const pages = yield* db.all<{ page_count: number }>(sql`PRAGMA page_count`);
  const pageSize = yield* db.all<{ page_size: number }>(sql`PRAGMA page_size`);
  const free = yield* db.all<{ freelist_count: number }>(sql`PRAGMA freelist_count`);
  return {
    pages: pages[0]?.page_count ?? 0,
    freePages: free[0]?.freelist_count ?? 0,
    pageSize: pageSize[0]?.page_size ?? 0,
  };
});

export const vacuumStore = Effect.fn('Store.vacuum')(function* (
  db: EffectSQLiteBunDatabase,
  path: string,
  freeBytes: (path: string) => Effect.Effect<number>,
): Effect.fn.Return<VacuumVerdict, StoreFailure> {
  if (path === ':memory:') return { outcome: 'no-file' };
  const fileBytes = yield* Effect.promise(() => stat(path).then((file) => file.size));
  const free = yield* freeBytes(path);
  if (free < fileBytes) return { outcome: 'disk-short', fileBytes, freeBytes: free };
  const before = yield* sizeOf(db);
  const startedAt = yield* Clock.currentTimeMillis;
  yield* db.run(sql`PRAGMA auto_vacuum = INCREMENTAL`);
  yield* db.run(sql`VACUUM`);
  const heldMs = (yield* Clock.currentTimeMillis) - startedAt;
  const after = yield* sizeOf(db);
  return {
    outcome: 'vacuumed',
    vacuum: { before, after, pagesReturned: before.pages - after.pages, heldMs },
  };
});

export type Freeing = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<readonly [A, number], E | StoreFailure, R>;

export const reclaiming = Effect.fnUntraced(function* (db: EffectSQLiteBunDatabase, transaction: Store<'machine'>['transaction']) {
  const due = yield* Queue.sliding<void>(1);
  let owed = 0;
  let returned = 0;
  let unsettled = 0;
  let step = 1;
  let heldFrom = 0;
  const free = Effect.map(db.all<{ freelist_count: number }>(sql`PRAGMA freelist_count`), ([row]) => row?.freelist_count ?? 0);
  const freed = transaction(RECLAIM, () => Effect.map(free, (pages) => pages + returned));
  const portion = transaction(RECLAIM, () =>
    Effect.gen(function* () {
      heldFrom = performance.now();
      const [mode] = yield* db.all<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`);
      owed = mode?.auto_vacuum === INCREMENTAL ? Math.min(owed, yield* free) : 0;
      while (owed > 0 && performance.now() - heldFrom < PORTION_MS) {
        const pages = Math.min(step, owed);
        const sent = performance.now();
        yield* db.run(sql.raw(`PRAGMA incremental_vacuum(${pages})`));
        const took = performance.now() - sent;
        owed -= pages;
        returned += pages;
        unsettled += pages;
        step = took < PORTION_MS / 4 ? pages * 2 : took > PORTION_MS / 2 ? Math.max(1, Math.floor(pages / 2)) : pages;
      }
    }),
  );
  const undone = Effect.sync(() => {
    owed += unsettled;
    returned -= unsettled;
  });
  const drain = Effect.gen(function* () {
    step = 1;
    while (owed > 0) {
      unsettled = 0;
      yield* Effect.onError(portion, () => undone);
      yield* Effect.sleep(Math.max(PORTION_MS, performance.now() - heldFrom));
    }
  });
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.andThen(
        Queue.take(due),
        drain.pipe(
          Effect.tapError((failure) => Effect.logWarning('freed pages could not be returned to the disk', { reason: failure.message })),
          Effect.retry(RETRY),
        ),
      ),
    ),
  );
  return Effect.fnUntraced(function* <A, E, R>(work: Effect.Effect<A, E, R>) {
    const before = yield* freed;
    const value = yield* work;
    const pages = Math.max(0, (yield* freed) - before);
    if (pages > 0) {
      owed += pages;
      Queue.offerUnsafe(due, undefined);
    }
    return [value, pages] as const;
  });
});
