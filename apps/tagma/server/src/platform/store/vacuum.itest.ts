import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../contract/service/store.js';
import { storePlace } from '../testing/connection.js';
import { storeLayer } from './open.js';

const PROBE_ROWS = 400;

const PAGE_ROW_BYTES = 3_000;

const opened = (path: string, options?: Parameters<typeof storeLayer>[3]) =>
  Effect.map(Layer.build(Layer.orDie(storeLayer(MachineStore, path, fixtureMigrations, options))), Context.get(MachineStore));

const fill = Effect.fnUntraced(function* (store: MachineStore['Service'], table: string, rows: number, bytes = 2_048) {
  yield* store.db.run(sql.raw(`create table if not exists ${table} (value blob not null)`));
  yield* store.db.run(
    sql.raw(`
      insert into ${table} (value)
      with recursive n(i) as (select 1 union all select i + 1 from n where i < ${rows})
      select randomblob(${bytes}) from n
    `),
  );
});

const empty = (store: MachineStore['Service'], table: string) => store.db.run(sql.raw(`delete from ${table}`));

const fillAndFree = (store: MachineStore['Service']) =>
  Effect.andThen(fill(store, 'vacuum_probe', PROBE_ROWS), empty(store, 'vacuum_probe'));

const pageCount = (store: MachineStore['Service']) =>
  Effect.map(store.db.all<{ page_count: number }>(sql`PRAGMA page_count`), (rows) => rows[0]?.page_count ?? 0);

const freeCount = (store: MachineStore['Service']) =>
  Effect.map(store.db.all<{ freelist_count: number }>(sql`PRAGMA freelist_count`), (rows) => rows[0]?.freelist_count ?? 0);

const freeAfterReturn = Effect.fnUntraced(function* (store: MachineStore['Service']) {
  for (let tries = 0; tries < 100; tries += 1) {
    if ((yield* freeCount(store)) === 0) break;
    yield* Effect.sleep(50);
  }
  return yield* freeCount(store);
});

layer(BunFileSystem.layer, { excludeTestServices: true })('store vacuum', (it) => {
  it.effect('vacuum shrinks the file, and pages handed back to the store are returned without a rewrite', () =>
    Effect.gen(function* () {
      const store = yield* opened(yield* storePlace('tagma-reach-'));
      yield* fillAndFree(store);

      const swollen = yield* pageCount(store);
      const verdict = yield* store.vacuum();
      if (verdict.outcome !== 'vacuumed') return yield* Effect.die(`vacuum declined: ${verdict.outcome}`);
      expect(verdict.vacuum.before.pages).toBe(swollen);
      expect(verdict.vacuum.after.pages).toBeLessThan(swollen);
      expect(verdict.vacuum.pagesReturned).toBe(swollen - verdict.vacuum.after.pages);
      expect(verdict.vacuum.after.freePages).toBe(0);

      yield* fill(store, 'vacuum_probe', PROBE_ROWS);
      const grown = yield* pageCount(store);
      const [, freed] = yield* store.freeing(empty(store, 'vacuum_probe'));
      expect(freed).toBeGreaterThan(0);
      expect(yield* freeAfterReturn(store)).toBe(0);
      expect(yield* pageCount(store)).toBeLessThanOrEqual(grown - freed);
    }),
  );

  it.effect('a writer lands while freed pages are being returned, and pages freed meanwhile are returned too', () =>
    Effect.gen(function* () {
      const store = yield* opened(yield* storePlace('tagma-reach-'));
      yield* store.vacuum();
      yield* fill(store, 'first_probe', 20_000, PAGE_ROW_BYTES);
      yield* fill(store, 'second_probe', 2_000, PAGE_ROW_BYTES);

      const [, first] = yield* store.freeing(empty(store, 'first_probe'));
      expect(first).toBeGreaterThan(0);
      for (let tries = 0; tries < 200 && (yield* freeCount(store)) >= first; tries += 1) yield* Effect.sleep(5);
      const landed = yield* store.transaction('vacuum_probe.write', () =>
        Effect.andThen(store.db.run(sql`insert into second_probe (value) values (x'00')`), freeCount(store)),
      );
      expect(landed).toBeGreaterThan(0);

      const [, second] = yield* store.freeing(empty(store, 'second_probe'));
      expect(second).toBeGreaterThan(0);
      expect(yield* freeAfterReturn(store)).toBe(0);
    }),
  );

  it.effect('vacuum refuses a rewrite the filesystem cannot hold, naming the file and the room left', () =>
    Effect.gen(function* () {
      const store = yield* opened(yield* storePlace('tagma-reach-'), { freeBytes: () => Effect.succeed(0) });
      yield* fillAndFree(store);
      const before = yield* pageCount(store);
      const verdict = yield* store.vacuum();
      if (verdict.outcome !== 'disk-short') return yield* Effect.die(`vacuum did not refuse: ${verdict.outcome}`);
      expect(verdict.freeBytes).toBe(0);
      expect(verdict.fileBytes).toBeGreaterThan(0);
      expect(yield* pageCount(store)).toBe(before);
    }),
  );
});
