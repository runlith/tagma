import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import type { InputReceipt } from '@runlith/executions/protocol/input';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { Clock, Context, Effect, Exit, Layer, Scope } from 'effect';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { project } from '../../projects/store/table.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';
import { makeTerminalWriters, type TerminalWriters } from './writers.js';
import { storesOver } from '../testing/stores.js';
import { TerminalRows } from '../store/terminalRows.js';

const installation = InstallationId.make('i');
const operator = Principal.make('operator');
const agent = Principal.make('thread:agent');

let through = 0;
const receiptOf = (execution: ExecutionRef, sequence = 0): InputReceipt => ({
  execution,
  sequence,
  cause: 'typed',
  bytes: 1,
  acceptedThrough: ByteOffset.make(String(++through)),
});

const world = Effect.fnUntraced(function* () {
  const context = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, yield* sharedPool))),
    ),
  );
  const db = Context.get(context, MachineStore).db;
  const units = Context.get(context, MachineUnits);
  const store = storesOver(db, installation);
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const [row] = yield* Effect.orDie(
    units.write('TerminalWriters.world', (unit) =>
      unit.run(
        db.insert(project).values({ name: 'mine', repoKey: 'mine-repo', rootPath: '/mine', createdAt }).returning({ id: project.id }),
      ),
    ),
  );
  const record: TerminalRecord = {
    projectId: row!.id,
    execution: { installation, execution: ExecutionId.make('exec'), incarnation: 0 },
    transport: 'pty',
    lifetime: 'held',
    targetKey: 'k' as never,
    holder: agent,
    origin: agent,
    revision: 1 as never,
    holdings: {},
    acceptedAt: 0,
  };
  yield* Effect.orDie(units.write('TerminalWriters.world', (unit) => store.terminalRows.project(unit, record)));
  const stored = Effect.orDie(units.read((unit) => store.terminalRows.writers(unit, record.execution)));
  return {
    execution: record.execution,
    owner: Effect.fnUntraced(function* (everyMs?: number) {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const writers = yield* makeTerminalWriters({ everyMs }).pipe(
        Scope.provide(scope),
        Effect.provideService(MachineUnits, units),
        Effect.provideService(TerminalRows, store.terminalRows),
      );
      return { writers, close: Scope.close(scope, Exit.void) };
    }),
    stored,
    others: (writers: TerminalWriters, reader: Principal) => Effect.orDie(writers.others(record.execution, reader)),
    until: Effect.fnUntraced(function* (done: (rows: Effect.Success<typeof stored>) => boolean) {
      const deadline = (yield* Clock.currentTimeMillis) + 5_000;
      let value = yield* stored;
      while (!done(value) && (yield* Clock.currentTimeMillis) < deadline) {
        yield* Effect.sleep(10);
        value = yield* stored;
      }
      return value;
    }),
  };
});

it.live('another writer is answered with the time of its newest act, and the reader never with its own', () =>
  Effect.gen(function* () {
    const held = yield* world();
    const { writers } = yield* held.owner();
    expect(yield* held.others(writers, agent)).toEqual([]);
    yield* writers.admitted(held.execution, agent, receiptOf(held.execution), 1_000);
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), 2_000);
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), 3_000);
    expect(yield* held.others(writers, agent)).toEqual([{ writer: operator, at: 3_000 }]);
    expect(yield* held.others(writers, operator)).toEqual([{ writer: agent, at: 1_000 }]);
  }),
);

it.live('a receipt the host answers again for a retried sequence is not a new act', () =>
  Effect.gen(function* () {
    const held = yield* world();
    const { writers } = yield* held.owner();
    const receipt = receiptOf(held.execution);
    yield* writers.admitted(held.execution, operator, receipt, 1_000);
    yield* writers.admitted(held.execution, operator, receipt, 9_000);
    expect(yield* held.others(writers, agent)).toEqual([{ writer: operator, at: 1_000 }]);
  }),
);

it.live('the first act of a burst is stored at once, so a process that starts afresh still answers it', () =>
  Effect.gen(function* () {
    const held = yield* world();
    const at = yield* Clock.currentTimeMillis;
    const { writers } = yield* held.owner();
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), at);
    yield* held.until((rows) => rows.length === 1);
    const { writers: afresh } = yield* held.owner();
    expect(yield* held.others(afresh, agent)).toEqual([{ writer: operator, at }]);
  }),
);

it.live('acts inside the throttle window are stored once when it closes, carrying the newest', () =>
  Effect.gen(function* () {
    const held = yield* world();
    const { writers } = yield* held.owner(200);
    const first = yield* Clock.currentTimeMillis;
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), first);
    yield* held.until((rows) => rows.length === 1);
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), first + 10);
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), first + 20);
    expect(yield* held.stored).toEqual([{ writer: operator, at: first }]);
    expect(yield* held.until((rows) => rows[0]?.at === first + 20)).toEqual([{ writer: operator, at: first + 20 }]);
  }),
);

it.live('an owner closed inside the throttle window stores the newest act before it goes', () =>
  Effect.gen(function* () {
    const held = yield* world();
    const { writers, close } = yield* held.owner();
    const first = yield* Clock.currentTimeMillis;
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), first);
    yield* held.until((rows) => rows.length === 1);
    yield* writers.admitted(held.execution, operator, receiptOf(held.execution), first + 10);
    yield* close;
    expect(yield* held.stored).toEqual([{ writer: operator, at: first + 10 }]);
  }),
);
