import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq, sql } from 'drizzle-orm';
import { thread as nativeThread } from '../threads/store/kernel.js';
import { Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureMigrations } from '../composition/testing/migrations.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { seededStoreLayer } from '../platform/store/open.js';
import { unitsLayer } from '../platform/store/units.js';
import { clearExternalLeftovers } from './externalLeftovers.js';

const AT = 1700000000000;
const AUTHORITY = JSON.stringify({ mode: 'trust', bypassFrom: null });

const seeded = Effect.gen(function* () {
  const store = yield* MachineStore;
  yield* store.db.run(
    sql`insert into thread (id, origin, spawn_root_id, principal_id, harness, agent_id, reader_order_at, created_at) values ('x', 'unscoped', 'x', 'owner-x', 'codex', 'harness', ${AT}, ${AT})`,
  );
  yield* store.db.run(
    sql`insert into thread (id, origin, spawn_root_id, principal_id, harness, agent_id, reader_order_at, created_at) values ('n', 'unscoped', 'n', 'owner-n', 'tagma', 'tagma', ${AT}, ${AT})`,
  );
  yield* store.db.run(sql`insert into thread_mandate (id, authority) values ('x', ${AUTHORITY})`);
  yield* store.db.insert(nativeThread).values({ id: 'n', cacheGroup: 'n', provider: 'test-provider', updatedAt: new Date(AT) });
  yield* store.db.run(sql`insert into thread_log (thread_id) values ('x')`);
  yield* store.db.run(sql`insert into thread_log (thread_id) values ('n')`);
  yield* store.db.run(
    sql`insert into thread_run (id, thread_id, status, owner_id, started_at, heartbeat_at, created_at, updated_at) values ('run-x', 'x', 'running', 'owner-x', ${AT}, ${AT}, ${AT}, ${AT})`,
  );
  yield* store.db.run(
    sql`insert into thread_entry (thread_id, ord, entry_id, type, entry) values ('x', 0, 'e1', 'message', '{"id":"e1","body":"hello"}')`,
  );
  yield* store.db.run(
    sql`insert into thread_event (thread_id, position, id, kind, payload) values ('x', 1, 'evt-x', 'message', '{"bodyInFold":true,"entry":{"id":"e1"}}')`,
  );
});

const fixture = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

layer(fixture)('external leftovers', (it) => {
  it.effect('clearing external leftovers restores folds, drops native children and keeps native threads', () =>
    Effect.gen(function* () {
      const store = yield* MachineStore;
      yield* seeded;
      expect(yield* clearExternalLeftovers).toBe(1);
      const events = yield* store.db.all<{ payload: string }>(sql`select payload from thread_event where thread_id = 'x'`);
      expect(events.map((row) => JSON.parse(row.payload) as unknown)).toEqual([{ entry: { id: 'e1', body: 'hello' } }]);
      expect(yield* store.db.all(sql`select count(*) as n from thread_log where thread_id = 'x'`)).toEqual([{ n: 0 }]);
      expect(yield* store.db.all(sql`select count(*) as n from thread_entry where thread_id = 'x'`)).toEqual([{ n: 0 }]);
      expect(yield* store.db.all(sql`select count(*) as n from thread_run where thread_id = 'x'`)).toEqual([{ n: 0 }]);
      expect(yield* store.db.all(sql`select count(*) as n from thread_log where thread_id = 'n'`)).toEqual([{ n: 1 }]);
      expect(yield* store.db.select({ id: nativeThread.id }).from(nativeThread).where(eq(nativeThread.id, 'n'))).toEqual([{ id: 'n' }]);
      expect(yield* clearExternalLeftovers).toBe(0);
    }),
  );

  it.effect('clearing leaves the journal, fold and run of an ACP thread intact', () =>
    Effect.gen(function* () {
      const store = yield* MachineStore;
      yield* store.db.run(
        sql`insert into thread (id, origin, spawn_root_id, principal_id, harness, agent_id, reader_order_at, created_at) values ('acp', 'unscoped', 'acp', 'owner-acp', 'claude-code', 'harness', ${AT}, ${AT})`,
      );
      yield* store.db.run(
        sql`insert into external_session (id, facet, updated_at) values ('acp', '{"name":"claude-code","transport":"acp"}', ${AT})`,
      );
      yield* store.db.insert(nativeThread).values({ id: 'acp', provider: 'external', cacheGroup: 'acp', updatedAt: new Date(AT) });
      yield* store.db.run(sql`insert into thread_log (thread_id) values ('acp')`);
      yield* store.db.run(
        sql`insert into thread_run (id, thread_id, status, owner_id, started_at, heartbeat_at, created_at, updated_at) values ('run-acp', 'acp', 'running', 'owner-acp', ${AT}, ${AT}, ${AT}, ${AT})`,
      );
      yield* store.db.run(
        sql`insert into thread_entry (thread_id, ord, entry_id, type, entry) values ('acp', 0, 'acp-message', 'message', '{"id":"acp-message","body":"held"}')`,
      );
      yield* store.db.run(
        sql`insert into thread_event (thread_id, position, id, kind, payload) values ('acp', 1, 'evt-acp', 'message', '{"bodyInFold":true,"entry":{"id":"acp-message"}}')`,
      );
      expect(yield* clearExternalLeftovers).toBe(0);
      expect(yield* store.db.all(sql`select thread_id from thread_log where thread_id = 'acp'`)).toEqual([{ thread_id: 'acp' }]);
      expect(yield* store.db.all(sql`select id, status from thread_run where thread_id = 'acp'`)).toEqual([
        { id: 'run-acp', status: 'running' },
      ]);
      expect(yield* store.db.all(sql`select entry_id from thread_entry where thread_id = 'acp'`)).toEqual([{ entry_id: 'acp-message' }]);
      const events = yield* store.db.all<{ payload: string }>(sql`select payload from thread_event where thread_id = 'acp'`);
      expect(events.map((row) => JSON.parse(row.payload))).toEqual([{ bodyInFold: true, entry: { id: 'acp-message' } }]);
    }),
  );
});
