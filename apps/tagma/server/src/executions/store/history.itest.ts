import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { makeExecutionHistory } from './history.js';
import { InstallationId } from '@runlith/executions/protocol/execution';
import { storesOver } from '../testing/stores.js';

const world = Effect.fnUntraced(function* () {
  const context = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, yield* sharedPool))),
    ),
  );
  const { db } = Context.get(context, MachineStore);
  const units = Context.get(context, MachineUnits);
  const exec = (statement: ReturnType<typeof sql>) => Effect.orDie(db.run(statement));
  yield* exec(sql`insert into project (id, name, repo_key, root_path, created_at) values (1, 'p', '/p', '/p', 0)`);
  yield* exec(sql`insert into file_root_namespace (namespace_id, revision) values ('ns', 1)`);
  yield* exec(
    sql`insert into file_root (root_id, namespace_id, path, location_revision, witness_provider, witness_format, witness_token, provenance, state)
        values ('root', 'ns', '/p', 1, 'w', 'f', 't', 'test', 'active')`,
  );
  for (const id of ['gone', 'kept']) {
    yield* exec(
      sql`insert into thread (id, project_id, origin, spawn_root_id, principal_id, agent_id, reader_order_at, created_at)
          values (${id}, 1, 'scoped', ${id}, 'operator', 'tagma', 0, 0)`,
    );
  }
  const use = Effect.fnUntraced(function* (useId: string, state: 'held' | 'released') {
    yield* exec(
      sql`insert into root_use (use_id, namespace_id, path, consumer_kind, consumer_id, mode, state)
          values (${useId}, 'ns', '/p', 'command', ${useId}, 'shared', ${state})`,
    );
    yield* exec(sql`insert into root_use_hold (use_id, root_id, location_revision) values (${useId}, 'root', 1)`);
  });
  const commandOf = Effect.fnUntraced(function* (id: string, thread: string, state: 'held' | 'released', standing = false) {
    yield* use(`use-${id}`, state);
    yield* exec(
      sql`insert into command (execution_id, incarnation, project_id, owner, owner_thread, created_by, policy_identity, target_key, admitted_at, root_use_id)
          values (${id}, 1, 1, ${`thread:${thread}`}, ${thread}, ${`thread:${thread}`}, 'policy', 'target', 0, ${`use-${id}`})`,
    );
    if (standing) {
      yield* exec(
        sql`insert into command_wait (execution_id, incarnation, mode, revision, moved_at) values (${id}, 1, 'foreground', 1, 0)`,
      );
    }
  });
  const terminalOf = Effect.fnUntraced(function* (id: string, thread: string, discharged: boolean) {
    yield* use(`use-${id}`, discharged ? 'released' : 'held');
    yield* exec(
      sql`insert into terminal (execution_id, incarnation, project_id, transport, lifetime, target_key, holder, origin, revision, accepted_at, discharged_at, root_use_id)
          values (${id}, 1, 1, 'pipes', 'call', 'target', ${`thread:${thread}`}, ${`thread:${thread}`}, 1, 0, ${discharged ? 1 : null}, ${`use-${id}`})`,
    );
  });
  yield* commandOf('c-gone', 'gone', 'released');
  yield* commandOf('c-gone-standing', 'gone', 'held', true);
  yield* commandOf('c-kept', 'kept', 'released');
  yield* terminalOf('t-gone', 'gone', true);
  yield* terminalOf('t-gone-live', 'gone', false);
  yield* terminalOf('t-kept', 'kept', true);
  const ids = (table: string, column: string) =>
    Effect.map(
      Effect.orDie(db.all<{ readonly id: string }>(sql`select ${sql.raw(column)} as id from ${sql.raw(table)} order by 1`)),
      (rows) => rows.map((row) => row.id),
    );
  const standing = Effect.all({
    commands: ids('command', 'execution_id'),
    terminals: ids('terminal', 'execution_id'),
    uses: ids('root_use', 'use_id'),
    holds: ids('root_use_hold', 'use_id'),
  });
  const history = yield* Effect.provide(makeExecutionHistory, context);
  const store = storesOver(db, InstallationId.make('i'));
  return { exec, history, standing, use, units, store };
});

const NEIGHBOUR_AND_WORKING = {
  commands: ['c-gone-standing', 'c-kept'],
  terminals: ['t-gone-live', 't-kept'],
  uses: ['use-c-gone-standing', 'use-c-kept', 'use-t-gone-live', 'use-t-kept'],
};

it.live(
  'a deleted thread leaves no ended command or discharged terminal, no released use holds a root, and standing work keeps its holds',
  () =>
    Effect.gen(function* () {
      const held = yield* world();
      yield* held.exec(sql`delete from thread where id = 'gone'`);

      yield* held.history.forgetGone();

      expect(yield* held.standing).toEqual({
        ...NEIGHBOUR_AND_WORKING,
        uses: ['use-c-gone-standing', 'use-t-gone-live'],
        holds: ['use-c-gone-standing', 'use-t-gone-live'],
      });
      yield* held.history.forgetGone();
      expect((yield* held.standing).uses).toEqual(['use-c-gone-standing', 'use-t-gone-live']);
    }),
);

it.live('sweeping released uses preserves other consumers and unresolved intents until their reference leaves', () =>
  Effect.gen(function* () {
    const held = yield* world();
    yield* held.use('other-consumer', 'released');
    yield* held.use('unresolved', 'released');
    yield* held.use('orphan', 'released');
    yield* held.exec(sql`update root_use set consumer_kind = 'sandbox' where use_id = 'other-consumer'`);
    yield* held.exec(sql`insert into terminal_intent (project_id, operation_id, phase, root_use_id, opened_at)
      values (1, 'pending', 'reserved', 'unresolved', 0)`);
    yield* held.history.forgetGone();
    expect((yield* held.standing).uses).toEqual(['other-consumer', 'unresolved', 'use-c-gone-standing', 'use-t-gone-live']);
    expect((yield* held.standing).holds).toEqual(['other-consumer', 'unresolved', 'use-c-gone-standing', 'use-t-gone-live']);
    yield* held.exec(sql`delete from terminal_intent where operation_id = 'pending'`);
    yield* held.history.forgetGone();
    expect((yield* held.standing).uses).toEqual(['other-consumer', 'use-c-gone-standing', 'use-t-gone-live']);
  }),
);

it.live('discharge retires released root accounting atomically and projection cannot restore it', () =>
  Effect.gen(function* () {
    const { units, store, standing } = yield* world();
    const command = yield* units.read((unit) => store.commandRows.recordCommand(unit, 'c-kept'));
    const terminal = yield* units.read((unit) => store.terminalRows.record(unit, 't-kept'));
    if (command === null || terminal === null) return yield* Effect.die('Execution fixtures are missing');
    const rolledBack = yield* Effect.result(
      units.write('discharge.rollback', (unit) =>
        store.intents.dischargeCommand(unit, command.execution).pipe(Effect.andThen(Effect.fail('rollback'))),
      ),
    );
    expect(rolledBack._tag).toBe('Failure');
    expect((yield* standing).uses).toContain('use-c-kept');
    yield* units.write('discharge', (unit) =>
      Effect.gen(function* () {
        yield* store.intents.dischargeCommand(unit, command.execution);
        yield* store.intents.discharge(unit, terminal.execution);
        yield* store.commandRows.projectCommand(unit, command);
        yield* store.terminalRows.project(unit, { ...terminal, revision: terminal.revision + 1 });
      }),
    );
    expect((yield* standing).uses).toEqual(['use-c-gone', 'use-c-gone-standing', 'use-t-gone', 'use-t-gone-live']);
    for (const execution of [command.execution, terminal.execution]) {
      const obligation = yield* units.read((unit) => store.intents.obligation(unit, 1, execution));
      expect(obligation?.discharged).toBe(true);
      expect(obligation?.holdings).toEqual({});
    }
    yield* units.write('discharge.repeat', (unit) => store.intents.dischargeCommand(unit, command.execution));
    expect((yield* standing).commands).toContain('c-kept');
    expect((yield* standing).terminals).toContain('t-kept');
  }),
);

it.live('forgetting a named thread takes only its ended history, and the holds of a held use stay', () =>
  Effect.gen(function* () {
    const held = yield* world();

    yield* held.history.forgetThreads(['gone']);

    expect(yield* held.standing).toEqual({
      ...NEIGHBOUR_AND_WORKING,
      holds: ['use-c-gone-standing', 'use-c-kept', 'use-t-gone-live', 'use-t-kept'],
    });
  }),
);
