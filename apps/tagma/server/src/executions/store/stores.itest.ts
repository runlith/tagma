import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionId, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import { Clock, Context, Effect, Layer, Scope, Tracer, Exit } from 'effect';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { project } from '../../projects/store/table.js';
import { command, commandWait } from './terminal.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer, storeLayer } from '../../platform/store/open.js';
import { principalOf } from '../terminals/principals.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { replacedNoticeId } from './terminalRows.js';
import { HOST_REPLACED } from '../contract/service/custody.js';
import { storesOver } from '../testing/stores.js';

const installation = InstallationId.make('i');

const recordOf = (projectId: number, execution: string): TerminalRecord => ({
  projectId,
  execution: { installation, execution: ExecutionId.make(execution), incarnation: 0 },
  transport: 'pty',
  lifetime: 'held',
  targetKey: 'k' as never,
  holder: principalOf({ _tag: 'Operator' }),
  origin: principalOf({ _tag: 'Operator' }),
  revision: 1 as never,
  holdings: {},
  acceptedAt: 0,
});

const seeded = (readers?: number) =>
  unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(
      Layer.unwrap(
        Effect.map(sharedPool, (pool) => Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { readers, durable: false }, pool))),
      ),
    ),
  );

const opened = Effect.fnUntraced(function* (source: Layer.Layer<MachineStore | MachineUnits>, scope: Scope.Scope) {
  const context = yield* Layer.buildWithScope(source, scope);
  const db = Context.get(context, MachineStore).db;
  const units = Context.get(context, MachineUnits);
  return { db, units, store: storesOver(db, installation) };
});

const stored = Effect.fnUntraced(function* (source: Layer.Layer<MachineStore | MachineUnits> = seeded()) {
  const { db, units, store } = yield* opened(source, yield* Effect.scope);
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const rows = yield* Effect.orDie(
    units.write('stores.projects', (unit) =>
      unit.run(
        db
          .insert(project)
          .values([
            { name: 'mine', repoKey: 'mine-repo', rootPath: '/mine', createdAt },
            { name: 'theirs', repoKey: 'theirs-repo', rootPath: '/theirs', createdAt },
          ])
          .returning({ id: project.id }),
      ),
    ),
  );
  return { db, store, units, projects: [rows[0]!.id, rows[1]!.id] as const };
});

const sure = <A>(work: Effect.Effect<A, StoreFailure | unknown>) => Effect.orDie(work);

it.live('naming an execution of another project answers nothing', () =>
  Effect.gen(function* () {
    const { store, units, projects } = yield* stored();
    const [mine, theirs] = projects;
    yield* sure(
      units.write('stores', (unit) =>
        Effect.all([
          store.terminalRows.project(unit, recordOf(mine, 'exec-mine')),
          store.terminalRows.project(unit, recordOf(theirs, 'exec-theirs')),
        ]),
      ),
    );

    const answer = yield* sure(units.read((unit) => store.terminalRows.inventory(unit, mine, { execution: 'exec-theirs' })));

    expect(answer.records).toEqual([]);
    expect(answer.total).toBe(0);
  }),
);

it.live('a named execution obeys the custody bound the listing is asked under', () =>
  Effect.gen(function* () {
    const { store, units, projects } = yield* stored();
    const [mine] = projects;
    const gone = recordOf(mine, 'exec-gone');
    yield* sure(
      units.write('stores', (unit) =>
        Effect.all([store.terminalRows.project(unit, recordOf(mine, 'exec-held')), store.terminalRows.project(unit, gone)]).pipe(
          Effect.andThen(store.intents.discharge(unit, gone.execution)),
        ),
      ),
    );

    const standing = yield* sure(units.read((unit) => store.terminalRows.inventory(unit, mine, { execution: 'exec-gone' })));
    const history = yield* sure(
      units.read((unit) => store.terminalRows.inventory(unit, mine, { execution: 'exec-gone', standing: false })),
    );
    const held = yield* sure(units.read((unit) => store.terminalRows.inventory(unit, mine, { execution: 'exec-held' })));

    expect(standing.records).toEqual([]);
    expect(history.records.map((row) => row.execution.execution)).toEqual([ExecutionId.make('exec-gone')]);
    expect(held.records.map((row) => row.execution.execution)).toEqual([ExecutionId.make('exec-held')]);
  }),
);

const commandOf = (projectId: number, execution: string, admittedAt: number): CommandRecord =>
  ({
    projectId,
    execution: { installation, execution: ExecutionId.make(execution), incarnation: 0 },
    owner: { _tag: 'Operator' },
    origin: { _tag: 'Operator' },
    policyIdentity: 'policy',
    targetKey: 'target',
    holdings: {},
    admittedAt,
  }) as unknown as CommandRecord;

it.live('standing command pages preserve scope, tied admission order, cursor and generation matching', () =>
  Effect.gen(function* () {
    const { db, store, units, projects } = yield* stored(seeded(0));
    const [mine, theirs] = projects;
    const owned = { ...commandOf(mine, 'active-b', 30), owner: { _tag: 'Thread' as const, thread: ThreadId.make('owner') } };
    yield* sure(
      units.write('stores.commands', (unit) =>
        Effect.gen(function* () {
          const movedAt = new Date(yield* Clock.currentTimeMillis);
          for (const row of [
            commandOf(mine, 'old-active', 1),
            commandOf(mine, 'active-a', 30),
            owned,
            commandOf(mine, 'ended', 40),
            commandOf(mine, 'old-generation', 35),
            commandOf(theirs, 'foreign', 50),
          ]) {
            yield* store.commandRows.projectCommand(unit, row);
          }
          yield* unit.run(
            db.insert(commandWait).values(
              ['old-active', 'active-a', 'active-b', 'old-generation', 'foreign'].map((executionId) => ({
                executionId,
                incarnation: executionId === 'old-generation' ? 1 : 0,
                mode: 'foreground' as const,
                revision: 0,
                movedAt,
              })),
            ),
          );
        }),
      ),
    );
    const page = (selection: Parameters<typeof store.commandRows.commandPage>[2]) =>
      Effect.map(sure(units.read((unit) => store.commandRows.commandPage(unit, mine, selection))), (rows) =>
        rows.map((row) => String(row.record.execution.execution)),
      );
    expect(yield* page({ standing: true, order: 'newest', limit: 2 })).toEqual(['active-b', 'active-a']);
    expect(yield* page({ standing: true, order: 'newest', limit: 2, after: { admittedAt: 30, execution: 'active-a' } })).toEqual([
      'old-active',
    ]);
    expect(yield* page({ standing: true, order: 'oldest', limit: 2 })).toEqual(['old-active', 'active-a']);
    expect(yield* page({ standing: true, owner: owned.owner, limit: 2 })).toEqual(['active-b']);
    expect(yield* page({ standing: false, order: 'newest', limit: 2 })).toEqual(['ended', 'old-generation']);
  }),
);

it.live('a command page emits one span for the page, never one per row', () =>
  Effect.gen(function* () {
    const { store, units, projects } = yield* stored();
    const [mine] = projects;
    for (let at = 0; at < 30; at += 1) {
      yield* sure(units.write('stores', (unit) => store.commandRows.projectCommand(unit, commandOf(mine, `page-${at}`, 5 + at))));
    }

    const collect = Effect.fnUntraced(function* (limit: number) {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const page = yield* sure(units.read((unit) => store.commandRows.commandPage(unit, mine, { limit })).pipe(Effect.withTracer(tracer)));
      return { page, names: spans.map((span) => span.name) };
    });

    const narrow = yield* collect(3);
    const wide = yield* collect(30);

    expect(narrow.page).toHaveLength(3);
    expect(wide.page).toHaveLength(30);
    expect(narrow.names.filter((name) => name === 'CommandRows.commandPage')).toHaveLength(1);
    expect(wide.names.filter((name) => name === 'CommandRows.commandPage')).toHaveLength(1);
    expect(wide.names).toHaveLength(narrow.names.length);
    expect(wide.names.filter((name) => name.startsWith('CommandRows.') && name !== 'CommandRows.commandPage')).toEqual([]);
  }),
);

it.live('a command whose rule copy an older server stored with a null thread and through reads with those keys absent', () =>
  Effect.gen(function* () {
    const { db, store, units, projects } = yield* stored();
    const [mine] = projects;
    const copy = { id: 'r1', limitMs: 60_000, writer: 'operator', at: '2026-09-01T00:00:00.000Z', words: 'tests take a minute' };
    const admittedAt = new Date(yield* Clock.currentTimeMillis);
    yield* sure(
      units.write('stores', (unit) =>
        unit.run(
          db.insert(command).values({
            executionId: 'exec-old',
            incarnation: 0,
            projectId: mine,
            owner: 'operator',
            createdBy: 'operator',
            policyIdentity: 'p',
            targetKey: 'k',
            time: JSON.stringify({ tool: 'bash', rules: [{ ...copy, thread: null, through: null }] }),
            admittedAt,
          }),
        ),
      ),
    );

    const record = yield* sure(units.read((unit) => store.commandRows.recordCommand(unit, 'exec-old')));

    expect(record?.time?.rules).toEqual([copy]);
  }),
);

it.live('an inventory position walks the whole selection once, with the total beside it', () =>
  Effect.gen(function* () {
    const { store, units, projects } = yield* stored();
    const [mine] = projects;
    yield* sure(
      units.write('stores', (unit) =>
        Effect.all([
          store.terminalRows.project(unit, recordOf(mine, 'exec-a')),
          store.terminalRows.project(unit, recordOf(mine, 'exec-b')),
          store.terminalRows.project(unit, recordOf(mine, 'exec-c')),
        ]),
      ),
    );
    const names = (rows: readonly { readonly execution: { readonly execution: string } }[]) =>
      rows.map((row) => String(row.execution.execution));

    const first = yield* sure(units.read((unit) => store.terminalRows.inventory(unit, mine, { limit: 2 })));
    expect(names(first.records)).toEqual(['exec-c', 'exec-b']);
    expect(first.total).toBe(3);

    const second = yield* sure(
      units.read((unit) => store.terminalRows.inventory(unit, mine, { limit: 2, after: { acceptedAt: 0, execution: 'exec-b' } })),
    );
    expect(names(second.records)).toEqual(['exec-a']);
    expect(second.total).toBe(3);
  }),
);

it.live('records of many executions read in one query, whatever project holds them, and an unknown id is absent', () =>
  Effect.gen(function* () {
    const { store, units, projects } = yield* stored();
    const [mine, theirs] = projects;
    yield* sure(
      units.write('stores', (unit) =>
        Effect.all([
          store.terminalRows.project(unit, recordOf(mine, 'exec-a')),
          store.terminalRows.project(unit, recordOf(theirs, 'exec-b')),
        ]),
      ),
    );

    const found = yield* sure(units.read((unit) => store.terminalRows.records(unit, ['exec-a', 'exec-b', 'exec-none'])));

    expect([...found.keys()].sort()).toEqual(['exec-a', 'exec-b']);
    expect(found.get('exec-b')?.projectId).toBe(theirs);
  }),
);

const typingKey = (projectId: number, operationId: string, execution: string) => ({
  projectId,
  operationId: HostRequestKey.make(operationId),
  requester: principalOf({ _tag: 'Operator' }),
  mutation: 'write' as const,
  targetKey: 'k' as never,
  execution: { installation, execution: ExecutionId.make(execution), incarnation: 0 },
});

it.live('the migration that drops the control generation runs over rows written before it, and they read back', () =>
  Effect.gen(function* () {
    const home = mkdtempSync(join(tmpdir(), 'tagma-without-generation-'));
    yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(home, { force: true, recursive: true })));
    const path = join(home, 'tagma.sqlite');
    const file = unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(storeLayer(MachineStore, path, fixtureMigrations, { durable: false }, yield* sharedPool))),
    );

    const before = yield* Scope.make();
    const { db, store, units } = yield* opened(file, before);
    const createdAt = new Date(yield* Clock.currentTimeMillis);
    const [created] = yield* sure(
      units.write('stores.projects', (unit) =>
        unit.run(
          db.insert(project).values({ name: 'mine', repoKey: 'mine-repo', rootPath: '/mine', createdAt }).returning({ id: project.id }),
        ),
      ),
    );
    const mine = created!.id;
    const written = recordOf(mine, 'exec-before');
    const key = typingKey(mine, 'op-typed-before', 'exec-before');
    yield* sure(
      units.write('stores', (unit) => Effect.all([store.terminalRows.project(unit, written), store.requestKeys.register(unit, key)])),
    );
    yield* Scope.close(before, Exit.void);

    const rewound = new Database(path);
    rewound.exec('ALTER TABLE terminal ADD COLUMN generation integer NOT NULL DEFAULT 7');
    rewound.run("UPDATE terminal_request_key SET outcome = 'settled', input_outcome = ? WHERE operation_id = ?", [
      JSON.stringify({
        _tag: 'InputAdmitted',
        receipt: { execution: key.execution, generation: 7, sequence: 0, cause: 'typed', bytes: 3, acceptedThrough: '3' },
      }),
      'op-typed-before',
    ]);
    rewound.run("DELETE FROM __drizzle_migrations WHERE name LIKE '%_terminal_without_control_generation'");
    rewound.close();

    const after = yield* opened(file, yield* Effect.scope);
    const record = yield* sure(after.units.read((unit) => after.store.terminalRows.record(unit, 'exec-before')));
    const state = yield* sure(
      after.units.read((unit) => after.store.requestKeys.operation(unit, mine, HostRequestKey.make('op-typed-before'))),
    );

    expect(record).toEqual(written);
    expect(state).toMatchObject({
      _tag: 'Settled',
      input: { _tag: 'InputAdmitted', receipt: { sequence: 0, cause: 'typed', bytes: 3, acceptedThrough: '3' } },
    });
    expect(state._tag === 'Settled' && state.input?._tag === 'InputAdmitted' && 'generation' in state.input.receipt).toBe(false);
  }),
);

it.live('a typing key left pending or uncertain is spent by age like a settled one, and a start that never settled is not', () =>
  Effect.gen(function* () {
    const { store, units, projects } = yield* stored();
    const [mine] = projects;
    const pending = typingKey(mine, 'op-typing-pending', 'exec-typed');
    const uncertain = typingKey(mine, 'op-typing-uncertain', 'exec-typed');
    const start = { ...typingKey(mine, 'op-start-pending', 'exec-typed'), mutation: 'start' as const };
    yield* sure(
      units.write('stores', (unit) =>
        Effect.gen(function* () {
          yield* store.requestKeys.register(unit, pending);
          yield* store.requestKeys.register(unit, uncertain);
          yield* store.requestKeys.register(unit, start);
          yield* store.intents.settle(unit, mine, uncertain.operationId, {
            _tag: 'Uncertain',
            effect: { _tag: 'InFlight', operation: { installation, operation: uncertain.operationId } },
          });
        }),
      ),
    );

    const through = (yield* Clock.currentTimeMillis) + 1_000;
    const spent = yield* sure(units.write('stores.spent', (unit) => store.requestKeys.expire(unit, through)));
    const read = (operationId: HostRequestKey) =>
      Effect.map(sure(units.read((unit) => store.requestKeys.operation(unit, mine, operationId))), (state) => state._tag);

    expect(spent).toBe(2);
    expect(yield* read(pending.operationId)).toBe('Expired');
    expect(yield* read(uncertain.operationId)).toBe('Expired');
    expect(yield* read(start.operationId)).toBe('Pending');
  }),
);

it.live('a replacement owes each thread holding a terminal a notice at once, once per execution, and the operator’s terminals none', () =>
  Effect.gen(function* () {
    const { store, units, projects } = yield* stored();
    const [mine] = projects;
    const threadHeld: TerminalRecord = {
      ...recordOf(mine, 'exec-thread-held'),
      holder: principalOf({ _tag: 'Thread', threadId: ThreadId.make('thread-holder'), projectId: mine }),
      heldBy: ThreadId.make('thread-holder'),
      label: 'dev server',
    };
    yield* sure(
      units.write('stores', (unit) =>
        Effect.all([store.terminalRows.project(unit, threadHeld), store.terminalRows.project(unit, recordOf(mine, 'exec-operator-held'))]),
      ),
    );
    const held = yield* sure(units.read((unit) => store.terminalRows.held(unit)));
    yield* sure(units.write('stores', (unit) => store.terminalRows.noticeReplaced(unit, held, 1_000)));
    yield* sure(units.write('stores', (unit) => store.terminalRows.noticeReplaced(unit, held, 2_000)));

    const owed = yield* sure(units.read((unit) => store.terminalRows.notices(unit, 10)));
    expect(
      owed.map((notice) => ({
        operationId: notice.operationId,
        thread: notice.thread,
        requester: notice.requester,
        state: notice.state,
        openedAt: notice.openedAt,
      })),
    ).toEqual([
      {
        operationId: replacedNoticeId(threadHeld.execution),
        thread: 'thread-holder',
        requester: HOST_REPLACED,
        state: 'owed',
        openedAt: 1_000,
      },
    ]);
  }),
);
