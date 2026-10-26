import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { eq, sql } from 'drizzle-orm';
import { Clock, Context, Effect, Layer } from 'effect';
import { ExecutionId, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import { project } from '../../../projects/testing/doubles.js';
import { terminalRequestKey } from '../../../executions/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { TargetKey } from '../../../executions/contract/wire/targets.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import type { TerminalOperationKey } from '../../../executions/contract/wire/requestKeys.js';
import { runRetention } from '../../../executions/testing/doubles.js';
import { RETAINED_DETAIL_MS, RETAINED_SPENT_MS } from '../../../executions/contract/wire/requestKeys.js';
import { storesOver, type Stores } from '../../../executions/testing/stores.js';

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.map(sharedPool, (pool) => Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
    ),
  ),
);
const installation = InstallationId.make('retention');

const makeFixture = Effect.gen(function* () {
  const context = yield* Layer.build(storage);
  const db = Context.get(context, MachineStore).db;
  const units = Context.get(context, MachineUnits);
  const store = storesOver(db, installation, { retainedKeys: 3 });
  const now = new Date(yield* Clock.currentTimeMillis);
  const rows = yield* units.write('operationRetention.rows', (unit) =>
    unit.run(
      db
        .insert(project())
        .values({
          name: 'retention',
          repoKey: 'retention',
          rootPath: '/retention',
          createdAt: now,
        })
        .returning({ id: project().id }),
    ),
  );
  const projectId = rows[0]!.id;
  const key = (id: string): TerminalOperationKey => ({
    projectId,
    operationId: HostRequestKey.make(id),
    requester: principalOf({ _tag: 'Operator' }),
    mutation: 'start',
    targetKey: TargetKey.make('target'),
  });
  const register = (id: string) => units.write('operationRetention.register', (unit) => store.requestKeys.register(unit, key(id)));
  const settle = (id: string) =>
    units.write('operationRetention.settle', (unit) => store.intents.settle(unit, projectId, HostRequestKey.make(id), { _tag: 'Settled' }));
  const read = (id: string) => units.read((unit) => store.requestKeys.operation(unit, projectId, HostRequestKey.make(id)));
  const seed = (rows: number, outcome: 'settled' | 'expired', at: number, prefix: string, owner = projectId) =>
    units.write('operationRetention.seed', (unit) =>
      unit.run(
        db.run(sql`
      with recursive n(i) as (select 1 union all select i + 1 from n where i < ${rows})
      insert into terminal_request_key (project_id, operation_id, requester, mutation, target_key, outcome, at)
      select ${owner}, ${prefix} || i, 'operator', 'start', 'target', ${outcome}, ${at} from n
    `),
      ),
    );
  const counted = () =>
    units
      .read((unit) =>
        unit.run(
          db
            .select({
              outcome: terminalRequestKey().outcome,
              count: sql<number>`count(*)`,
            })
            .from(terminalRequestKey())
            .groupBy(terminalRequestKey().outcome)
            .all(),
        ),
      )
      .pipe(
        Effect.map((rows) => {
          const counts = { pending: 0, admitted: 0, uncertain: 0, settled: 0, expired: 0 };
          for (const row of rows) counts[row.outcome] = row.count;
          return counts;
        }),
      );
  const tallied = (over: Stores = store) =>
    units
      .read((unit) => over.requestKeys.keyRetention(unit))
      .pipe(Effect.map(({ pending, admitted, uncertain, settled, expired }) => ({ pending, admitted, uncertain, settled, expired })));
  return { db, units, store, projectId, key, register, settle, read, seed, counted, tallied };
});

it.live('settled receipts yield to new keys, while the spent identity still refuses reuse', () =>
  Effect.gen(function* () {
    const { register, settle, read, units, store } = yield* makeFixture;
    yield* register('pending');
    for (const id of ['first', 'second']) {
      yield* register(id);
      yield* settle(id);
    }
    expect((yield* register('next'))._tag).toBe('Pending');
    expect((yield* read('pending'))._tag).toBe('Pending');
    expect((yield* read('first'))._tag).toBe('Expired');
    const replay = yield* Effect.result(register('first'));
    expect(replay._tag).toBe('Failure');
    if (replay._tag === 'Failure') expect(replay.failure).toMatchObject({ reason: 'operation-expired' });
    expect(yield* units.read((unit) => store.requestKeys.keyRetention(unit))).toEqual({
      retained: 3,
      pending: 2,
      admitted: 0,
      uncertain: 0,
      settled: 1,
      expired: 1,
      ceiling: 3,
    });
  }),
);

it.live('pending, admitted and uncertain keys survive pressure and refuse with their owning store', () =>
  Effect.gen(function* () {
    const { register, read, units, store, projectId } = yield* makeFixture;
    for (const id of ['pending', 'admitted', 'uncertain']) yield* register(id);
    yield* units.write('operationRetention', (unit) =>
      store.requestKeys.admit(unit, projectId, HostRequestKey.make('admitted'), {
        installation,
        execution: ExecutionId.make('accepted'),
        incarnation: 1,
      }),
    );
    yield* units.write('operationRetention', (unit) =>
      store.intents.settle(unit, projectId, HostRequestKey.make('uncertain'), {
        _tag: 'Uncertain',
        effect: { _tag: 'InFlight', operation: { installation, operation: HostRequestKey.make('uncertain') } },
      }),
    );
    const refused = yield* Effect.result(register('next'));
    expect(refused._tag).toBe('Failure');
    if (refused._tag === 'Failure') expect(refused.failure).toMatchObject({ reason: 'operation-capacity' });
    expect((yield* read('pending'))._tag).toBe('Pending');
    expect((yield* read('admitted'))._tag).toBe('Admitted');
    expect((yield* read('uncertain'))._tag).toBe('Uncertain');
    expect((yield* read('next'))._tag).toBe('Unknown');
  }),
);

const DAY = 24 * 60 * 60 * 1000;

it.live('the retention account agrees with the rows through every transition, a sweep and a project deletion', () =>
  Effect.gen(function* () {
    const { db, units, projectId, key, seed, tallied, counted } = yield* makeFixture;
    const now = yield* Clock.currentTimeMillis;
    const wide = storesOver(db, installation, { retainedKeys: 1_000 });
    const other = (yield* units.write('operationRetention.other', (unit) =>
      unit.run(
        db
          .insert(project())
          .values({
            name: 'departing',
            repoKey: 'departing',
            rootPath: '/departing',
            createdAt: new Date(now),
          })
          .returning({ id: project().id }),
      ),
    ))[0]!.id;
    yield* seed(40, 'settled', now - 10 * DAY, 'aged-');
    yield* seed(30, 'expired', now - 20 * DAY, 'forgotten-');
    yield* seed(20, 'settled', now, 'departing-', other);
    for (const id of ['a', 'b', 'c', 'd']) yield* units.write('operationRetention', (unit) => wide.requestKeys.register(unit, key(id)));
    yield* units.write('operationRetention', (unit) =>
      wide.requestKeys.admit(unit, projectId, HostRequestKey.make('b'), {
        installation,
        execution: ExecutionId.make('admitted'),
        incarnation: 1,
      }),
    );
    yield* units.write('operationRetention', (unit) => wide.intents.advance(unit, projectId, HostRequestKey.make('c'), 'uncertain'));
    yield* units.write('operationRetention', (unit) => wide.intents.settle(unit, projectId, HostRequestKey.make('d'), { _tag: 'Settled' }));
    expect(yield* tallied(wide)).toEqual(yield* counted());

    yield* runRetention(units, wide.requestKeys, now);
    expect(yield* tallied(wide)).toEqual(yield* counted());
    expect(yield* tallied(wide)).toMatchObject({ expired: 40, settled: 21 });

    yield* units.write('operationRetention', (unit) => unit.run(db.delete(project()).where(eq(project().id, other))));
    expect(yield* tallied(wide)).toEqual(yield* counted());
    expect(yield* tallied(wide)).toEqual({ pending: 1, admitted: 1, uncertain: 1, settled: 1, expired: 40 });
  }),
);

it.live('retention reaches a steady state: detail ages into spent keys, spent keys past their horizon are forgotten', () =>
  Effect.gen(function* () {
    const { db, units, key, seed, tallied } = yield* makeFixture;
    const now = yield* Clock.currentTimeMillis;
    const wide = storesOver(db, installation, { retainedKeys: 100_000 });
    const detailDays = RETAINED_DETAIL_MS / DAY;
    const spentDays = RETAINED_SPENT_MS / DAY;
    const history = 2 * spentDays;
    const start = now - history * DAY;
    for (let day = 0; day < history; day += 1) yield* seed(100, 'settled', start + day * DAY + DAY / 2, `day-${day}-`);
    yield* runRetention(units, wide.requestKeys, now);
    const first = yield* tallied(wide);
    expect(first).toMatchObject({ settled: 100 * detailDays, expired: 100 * (spentDays - detailDays) });

    for (let day = history; day < 2 * history; day += 1) {
      yield* seed(100, 'settled', start + day * DAY + DAY / 2, `day-${day}-`);
      yield* runRetention(units, wide.requestKeys, start + (day + 1) * DAY);
      expect(yield* tallied(wide)).toEqual(first);
    }
    const spentDay = 2 * history - 1 - detailDays;
    const spent = yield* Effect.result(
      units.write('operationRetention.spent', (unit) => wide.requestKeys.register(unit, key(`day-${spentDay}-1`))),
    );
    expect(spent._tag).toBe('Failure');
    if (spent._tag === 'Failure') expect(spent.failure).toMatchObject({ reason: 'operation-expired' });
  }),
);

it.live('a spent key whose execution still stands, or whose use is still held, outlives its horizon', () =>
  Effect.gen(function* () {
    const { db, units, projectId, store } = yield* makeFixture;
    const now = yield* Clock.currentTimeMillis;
    const old = now - 2 * RETAINED_SPENT_MS;
    yield* units.write('operationRetention', (unit) =>
      unit.run(
        db.run(sql`
      insert into terminal_request_key (project_id, operation_id, requester, mutation, target_key, execution_id, incarnation, outcome, at)
      values (${projectId}, 'still-running', 'operator', 'start', 'target', 'running-exec', 1, 'expired', ${old}),
             (${projectId}, 'still-holding', 'operator', 'start', 'target', 'ended-exec', 1, 'expired', ${old}),
             (${projectId}, 'let-go', 'operator', 'start', 'target', 'gone-exec', 1, 'expired', ${old})
    `),
      ),
    );
    yield* units.write('operationRetention', (unit) =>
      unit.run(
        db.run(sql`
      insert into command_wait (execution_id, incarnation, mode, revision, moved_at) values ('running-exec', 1, 'foreground', 0, ${old})
    `),
      ),
    );
    yield* units.write('operationRetention', (unit) =>
      unit.run(
        db.run(sql`
      insert into root_use (use_id, namespace_id, path, consumer_kind, consumer_id, mode, state)
      values ('held-use', 'namespace', '/retention', 'command', 'still-holding', 'shared', 'held')
    `),
      ),
    );
    yield* runRetention(units, store.requestKeys, now);
    const standing = yield* units.read((unit) =>
      unit.run(
        db
          .select({ operationId: terminalRequestKey().operationId })
          .from(terminalRequestKey())
          .orderBy(terminalRequestKey().operationId)
          .all(),
      ),
    );

    expect(standing.map((row) => row.operationId)).toEqual(['still-holding', 'still-running']);
    yield* units.write('operationRetention', (unit) => unit.run(db.run(sql`delete from command_wait where execution_id = 'running-exec'`)));
    yield* units.write('operationRetention', (unit) => unit.run(db.run(sql`delete from root_use where use_id = 'held-use'`)));
  }),
);

it.live('a retention pass puts a drifted account back to the rows', () =>
  Effect.gen(function* () {
    const { db, units, store, seed, tallied, counted } = yield* makeFixture;
    const now = yield* Clock.currentTimeMillis;
    yield* seed(12, 'settled', now, 'drift-');
    yield* units.write('operationRetention', (unit) => unit.run(db.run(sql`update terminal_request_key_tally set count = count + 5`)));
    yield* runRetention(units, store.requestKeys, now);

    expect(yield* tallied()).toEqual(yield* counted());
  }),
);

it.live('startup retention reclaims recent settled occupancy already persisted by an earlier server', () =>
  Effect.gen(function* () {
    const { db, units, register, settle } = yield* makeFixture;
    const now = yield* Clock.currentTimeMillis;
    for (const id of ['one', 'two', 'three']) {
      yield* register(id);
      yield* settle(id);
    }
    const reopened = storesOver(db, installation, { retainedKeys: 3 });
    expect(yield* runRetention(units, reopened.requestKeys, now)).toBe(1);
    expect((yield* register('after-reopen'))._tag).toBe('Pending');
  }),
);
