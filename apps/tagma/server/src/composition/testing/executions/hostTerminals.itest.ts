import { fixtureMigrations } from '../migrations.js';
import { sessionIdentityLayer } from '../../../external-harnesses/sessionPrefix.js';
import { type ExecutionFeedItem, type ExecutionsFailure, HostRefused, WireUnavailable } from '@runlith/executions/Executions';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { TerminalInput } from '@runlith/executions/TerminalInput';
import { ExecutionId, InstallationId, HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { ByteOffset, type ByteCursor, type RecordRange, type StreamPositions } from '@runlith/executions/protocol/record';
import type { ExecutionSummary, RuntimeStatus } from '@runlith/executions/protocol/runtime';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, Path, Queue, Stream, type Scope } from 'effect';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { NamespaceId } from '@runlith/files/namespace';
import { project } from '../../../projects/testing/doubles.js';
import { rootUse } from '../../../workspace/testing/doubles.js';
import { commandWait, floorServices, terminalIntent, terminalRequestKey } from '../../../executions/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { type TerminalRecord } from '../../../executions/contract/wire/terminals.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { TerminalUnavailable, type TerminalRefused } from '../../../executions/contract/wire/refusals.js';
import { UseId } from '../../../workspace/contract/wire/ids.js';
import { UNATTRIBUTED_MOVE } from '../../../executions/contract/service/custody.js';
import { hostTerminals, terminalEndings, terminalWriters, unreadHost } from '../../../executions/testing/doubles.js';
import type { TerminalWatched } from '../../../executions/contract/service/endings.js';
import { sweepKeyOf } from '../../../executions/testing/doubles.js';
import { grantBook } from '../../../executions/testing/doubles.js';
import { terminalInventory } from '../../../executions/testing/doubles.js';
import { fileRootStore } from '../../../workspace/testing/doubles.js';
import { rootRegistry } from '../../../workspace/testing/doubles.js';
import { rootUseStore } from '../../../workspace/testing/doubles.js';
import { rootUseLedger } from '../../../workspace/testing/doubles.js';
import { waitersOver } from '../../../executions/testing/waitersFixture.js';
import { storesOver } from '../../../executions/testing/stores.js';

type FloorInput = Parameters<typeof hostTerminals>[0];

const storage = Layer.unwrap(
  Effect.map(sharedPool, (pool) =>
    Layer.mergeAll(
      unitsLayer(MachineUnits, MachineStore).pipe(
        Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
      ),
      sessionIdentityLayer,
      BunFileSystem.layer,
      Path.layer,
    ),
  ),
);

const world = Effect.fnUntraced(function* (name: string, installation = InstallationId.make('i')) {
  const context = yield* Layer.build(storage);
  const db = Context.get(context, MachineStore).db;
  const units = Context.get(context, MachineUnits);
  const store = storesOver(db, installation);
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const [created] = yield* Effect.orDie(
    units.write('Terminals.projectId', (unit) =>
      unit.run(
        db
          .insert(project())
          .values({ name, repoKey: `${name}-repo`, rootPath: `/${name}`, createdAt })
          .returning({ id: project().id }),
      ),
    ),
  );
  const run = <A, E>(work: Effect.Effect<A, E, Layer.Success<typeof storage> | Scope.Scope>) => Effect.orDie(Effect.provide(work, context));
  const floor = (
    over: FloorInput,
    services: { readonly uses?: unknown; readonly environments?: unknown; readonly units?: MachineUnits['Service'] } = {},
  ) =>
    run(
      Effect.gen(function* () {
        return yield* hostTerminals({
          requestKeys: store.requestKeys,
          intents: store.intents,
          terminalRows: store.terminalRows,
          commandRows: store.commandRows,
          deliveries: store.deliveries,
          installation,
          waiters: yield* waitersOver(store.deliveries),
          ...over,
        }).pipe(Effect.provide(floorServices(services)), Effect.provideService(MachineUnits, services.units ?? units));
      }),
    );
  return { installation, db, store, units, projectId: created!.id, run, floor };
});

const bare = Effect.fnUntraced(function* (over: FloorInput) {
  return yield* (yield* world('bare')).floor(over);
});

const terminalOver = Effect.fnUntraced(function* (generation = 0) {
  const calls = { read: 0, state: 0 };
  const cursor: ByteCursor = {
    ref: {
      installation: InstallationId.make('i'),
      execution: ExecutionId.make('exec-1'),
      incarnation: 0,
    },
    stream: 'pty',
    offset: ByteOffset.make('0'),
  };
  const range: RecordRange = {
    cursor,
    next: ByteOffset.make('4'),
    retainedFrom: ByteOffset.make('0'),
    durableThrough: ByteOffset.make('4'),
    gap: false,
  };
  const positions: StreamPositions = {
    stream: 'pty',
    retainedFrom: ByteOffset.make('0'),
    durableThrough: ByteOffset.make('4'),
    parsedThrough: ByteOffset.make('4'),
    ending: 'open',
  };
  const executions = {
    read: () => {
      calls.read += 1;
      return Effect.succeed({ range, bytes: new Uint8Array([104, 105]) });
    },
    state: () => {
      calls.state += 1;
      return Effect.succeed({ streams: [positions] } as never);
    },
    generation: () => Effect.succeed(generation),
    served: () => Effect.succeed(new Set<never>()),
    subscribe: () => Stream.fail(new Error('a lost record is never asked of the host')),
  };
  const terminals = yield* bare({ executions: executions as never });
  return { calls, positions, range, terminals, cursor };
});

const standing: RuntimeStatus = {
  installation: InstallationId.make('i'),
  incarnation: 1,
  phase: 'open',
  holder: { _tag: 'Standing' },
  custody: { revision: 0, epoch: 0 },
  executions: 2,
  memory: {
    granted: { share: 0.25, machineBytes: 34_359_738_368, grantBytes: 8_589_934_592 },
    reserved: 17_686_528,
    retained: 4_096,
    executions: 2,
    ceiling: 374,
  },
};

it.live('input attributes human typing and mouse acts to other readers, but not refused, raw or harness input', () =>
  Effect.gen(function* () {
    const { store, units, projectId, run, floor } = yield* world('input-writers');
    const operator = Principal.make('operator');
    const reader = Principal.make('thread:reader');
    const record: TerminalRecord = { ...recordAt(0), projectId, holder: operator, origin: operator };
    yield* run(units.write('Terminals.inputWriters', (unit) => store.terminalRows.project(unit, record)));
    let through = 0;
    const executions = {
      ...unreadHost,
      ...TerminalInput.of({
        input: (execution, _scope, request) =>
          Effect.succeed({
            _tag: 'InputAdmitted',
            receipt: {
              execution,
              sequence: request.sequence,
              cause: request.cause,
              bytes: request.act._tag === 'Write' ? request.act.bytes.length : 0,
              acceptedThrough: ByteOffset.make(String(++through)),
            },
          }),
        openBinding: () => Effect.die('this fixture mints its view and harness grants directly'),
        closeBinding: (binding) => Effect.succeed({ _tag: 'Unbound', binding }),
      }),
    };
    const grants = grantBook({ executions });
    const view = BindingId.make('view-writer');
    const harness = BindingId.make('harness-writer');
    const claim = {
      projectId,
      execution: record.execution,
      actor: operator,
      targetKey: record.targetKey,
      binding: view,
      permissionRevision: 0,
    };
    yield* grants.mint(claim, 'view');
    yield* grants.mint({ ...claim, binding: harness }, 'harness');
    const writers = yield* terminalWriters({ terminalRows: store.terminalRows }).pipe(Effect.provideService(MachineUnits, units));
    const terminals = yield* floor({ executions, grants, writers });
    const bytes = new TextEncoder().encode('human');
    const input = { sequence: 0, cause: 'typed', act: { _tag: 'Write', bytes } } as const;
    expect(
      yield* Effect.flip(terminals.input(record.execution, { binding: BindingId.make('absent'), principal: operator }, input, 0)),
    ).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    expect((yield* terminals.input(record.execution, { binding: view, principal: operator }, { ...input, cause: 'raw' }, 0))._tag).toBe(
      'InputAdmitted',
    );
    expect((yield* terminals.input(record.execution, { binding: harness, principal: operator }, input, 0))._tag).toBe('InputAdmitted');
    expect(yield* terminals.typedBy(record.execution, reader)).toEqual([]);
    const typedAt = yield* Clock.currentTimeMillis;
    expect((yield* terminals.input(record.execution, { binding: view, principal: operator }, { ...input, sequence: 1 }, 0))._tag).toBe(
      'InputAdmitted',
    );
    const typed = yield* terminals.typedBy(record.execution, reader);
    expect(typed.map((one) => one.writer)).toEqual([operator]);
    expect(typed[0]!.at).toBeGreaterThanOrEqual(typedAt);
    expect(yield* terminals.typedBy(record.execution, operator)).toEqual([]);
    const clickedAt = yield* Clock.currentTimeMillis;
    expect(
      (yield* terminals.input(record.execution, { binding: view, principal: operator }, { ...input, sequence: 2, cause: 'mouse' }, 0))._tag,
    ).toBe('InputAdmitted');
    const clicked = yield* terminals.typedBy(record.execution, reader);
    expect(clicked.map((one) => one.writer)).toEqual([operator]);
    expect(clicked[0]!.at).toBeGreaterThanOrEqual(clickedAt);
  }),
);

it.live('a listing carries the host ledger the host itself answered', () =>
  Effect.gen(function* () {
    const terminals = yield* bare({ executions: { status: () => Effect.succeed(standing) } as never });
    expect(yield* terminals.ledger()).toEqual(standing.memory);
  }),
);

it.live('a host that does not answer leaves the ledger absent, never a ledger of zeros', () =>
  Effect.gen(function* () {
    const unreachable = new WireUnavailable({ kind: 'unreachable', reason: 'it did not answer', sent: false });
    const terminals = yield* bare({ executions: { status: () => Effect.fail(unreachable) } as never });
    expect(yield* terminals.ledger()).toBeUndefined();
  }),
);

it.live('a window that asks for nothing costs one host read and carries no positions', () =>
  Effect.gen(function* () {
    const { calls, range, terminals, cursor } = yield* terminalOver();
    const chunk = yield* terminals.bytes(cursor, 65_536);

    expect(calls).toEqual({ read: 1, state: 0 });
    expect(chunk.range).toEqual(range);
    expect('positions' in chunk).toBe(false);
  }),
);

it.live('a window that asks carries the positions the host answered for the stream', () =>
  Effect.gen(function* () {
    const { calls, positions, terminals, cursor } = yield* terminalOver();
    const chunk = yield* terminals.bytes(cursor, 65_536, { withPositions: true });

    expect(calls).toEqual({ read: 1, state: 1 });
    expect(chunk.positions).toEqual(positions);
  }),
);

it.live('a zero-byte read takes nothing from the record and answers the positions alone', () =>
  Effect.gen(function* () {
    const { calls, positions, terminals, cursor } = yield* terminalOver();
    const chunk = yield* terminals.bytes(cursor, 0, { withPositions: true });

    expect(calls).toEqual({ read: 0, state: 1 });
    expect(chunk.bytes).toHaveLength(0);
    expect(chunk.positions).toEqual(positions);
    expect(chunk.range).toEqual({
      cursor,
      next: cursor.offset,
      retainedFrom: positions.retainedFrom,
      durableThrough: positions.durableThrough,
      gap: false,
    });
  }),
);

it.live('a zero-byte read of a generation the host replaced answers the bounds of its retained record, not the refused live state', () =>
  Effect.gen(function* () {
    const { range, cursor } = yield* terminalOver();
    const replaced = new HostRefused({
      refusal: {
        _tag: 'HostUnavailable',
        reason: 'generation 0 was replaced by 1; its live state is gone and only its retained record remains',
      },
    });
    const terminals = yield* bare({
      executions: {
        read: () => Effect.succeed({ range, bytes: new Uint8Array([104]) }),
        state: () => Effect.fail(replaced),
        generation: () => Effect.succeed(1),
      } as never,
    });
    const chunk = yield* terminals.bytes(cursor, 0, { withPositions: true });

    expect(chunk.range).toEqual(range);
  }),
);

const recordAt = (incarnation: number): TerminalRecord => ({
  projectId: 5,
  execution: { installation: InstallationId.make('i'), execution: ExecutionId.make('exec-1'), incarnation },
  transport: 'pty',
  lifetime: 'held',
  targetKey: 'k' as never,
  holder: { kind: 'operator' } as never,
  origin: { kind: 'operator' } as never,
  revision: 1 as never,
  holdings: {},
  acceptedAt: 0,
});

it.live('a record below the host generation reads its retained bytes by key, and the host is asked', () =>
  Effect.gen(function* () {
    const { calls, range, terminals, cursor } = yield* terminalOver(1);
    const chunk = yield* terminals.bytes(cursor, 65_536);

    expect(calls.read).toBe(1);
    expect(chunk.bytes).toEqual(new Uint8Array([104, 105]));
    expect(chunk.range).toEqual(range);
  }),
);

it.live('following a record below the host generation refuses typed, and carries no ending a reader could take for an output', () =>
  Effect.gen(function* () {
    const { terminals, cursor } = yield* terminalOver(1);
    const refused = yield* Effect.flip(Stream.runCollect(terminals.records(cursor)));

    expect(refused._tag).toBe('TerminalRefused');
    expect((refused as TerminalRefused).reason).toBe('record-lost');
  }),
);

it.live('a record below the host generation is ended with its bytes readable by key; one at the generation is nothing', () =>
  Effect.gen(function* () {
    const gone = yield* (yield* terminalOver(1)).terminals.lost(recordAt(0));
    const live = yield* (yield* terminalOver(1)).terminals.lost(recordAt(1));

    expect(gone).toMatchObject({ phase: 'ended', cleanup: 'unverifiable', record: 'gapped' });
    expect('nativeExit' in (gone ?? {})).toBe(false);
    expect(live).toBeNull();
  }),
);

const stopRequest = (projectId: number, record: TerminalRecord) =>
  [
    projectId,
    {
      projectId,
      operationId: HostRequestKey.make('probe-stop-4'),
      requester: principalOf({ _tag: 'Operator' }),
      mutation: 'stop',
      targetKey: 'k' as never,
      execution: record.execution,
    },
    record.execution,
    1 as never,
    'explicit-stop',
    'signal',
  ] as const;

it.live('a stop aimed at a replaced generation discharges the row instead of asking a host that cannot know it', () =>
  Effect.gen(function* () {
    const { store, units, projectId, run, floor } = yield* world('replaced');
    const record: TerminalRecord = {
      ...recordAt(0),
      projectId,
      holder: principalOf({ _tag: 'Operator' }),
      origin: principalOf({ _tag: 'Operator' }),
      heldBy: ThreadId.make('thread-replaced'),
    };
    yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, record)));
    const asked: string[] = [];
    const executions = {
      generation: () => Effect.succeed(4),
      served: () => Effect.succeed(new Set<never>()),
      stop: () => {
        asked.push('stop');
        return Effect.die(new Error('a host is never asked about a generation it has replaced'));
      },
    };
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }) });

    const receipt = yield* run(terminals.stop(...stopRequest(projectId, record)));

    expect(asked).toEqual([]);
    expect(receipt.cleanup).toBe('unverifiable');
    expect(receipt.confirmed).toEqual([]);
    expect(receipt.coverage).toEqual([]);
    expect(receipt.unverifiable[0]?.reason ?? '').toContain('replaced');
    const after = yield* run(units.read((unit) => store.terminalRows.record(unit, record.execution.execution)));
    expect(after?.heldBy).toBeUndefined();
  }),
);

const replacedGeneration = Effect.fnUntraced(function* (name: string) {
  const { store, units, projectId, run, floor } = yield* world(name);
  const record: TerminalRecord = {
    ...recordAt(0),
    projectId,
    holder: principalOf({ _tag: 'Operator' }),
    origin: principalOf({ _tag: 'Operator' }),
    heldBy: ThreadId.make(`thread-${name}`),
  };
  yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, record)));
  const refused = new HostRefused({
    refusal: {
      _tag: 'HostUnavailable',
      reason: 'generation 0 was replaced by 1; its live state is gone and only its retained record remains',
    },
  });
  const executions = {
    generation: () => Effect.succeed(1),
    served: () => Effect.succeed(new Set<never>()),
    state: () => Effect.fail(refused),
    command: () => Effect.succeed(undefined),
    ending: () => Effect.succeed(undefined),
  };
  const terminals = yield* floor({ executions: executions as never });
  return { store, units, projectId, run, record, terminals };
});

it.live('a watched terminal of a replaced generation is decided at once and discharged instead of waiting on a host that refuses it', () =>
  Effect.gen(function* () {
    const { store, units, projectId, run, record, terminals } = yield* replacedGeneration('lost-watch');
    const opened = yield* Queue.unbounded<TerminalWatched>();
    const handed = yield* Queue.unbounded<ExecutionRef>();
    const endings = yield* run(
      terminalEndings({
        opened,
        ended: handed,
        terminals,
        discharge: terminals,
        terminalRows: store.terminalRows,
        commandRows: store.commandRows,
      }).pipe(Effect.provideService(MachineUnits, units)),
    );

    expect(yield* run(endings.decided({ projectId, execution: record.execution }))).toEqual({ _tag: 'Unwatchable' });
    expect(yield* Queue.take(handed)).toEqual(record.execution);
    const after = yield* run(units.read((unit) => store.terminalRows.record(unit, record.execution.execution)));
    expect(after?.heldBy).toBeUndefined();
  }),
);

it.live('an ending a replaced generation never recorded discharges its terminal instead of holding it as unended', () =>
  Effect.gen(function* () {
    const { store, units, projectId, run, record, terminals } = yield* replacedGeneration('lost-ending');

    expect(yield* run(terminals.ended(projectId, record.execution))).toEqual({ _tag: 'Discharged' });
    const after = yield* run(units.read((unit) => store.terminalRows.record(unit, record.execution.execution)));
    expect(after?.heldBy).toBeUndefined();
  }),
);

it.live('a standing command row of a replaced generation with no holdings is discharged, not read as foreign', () =>
  Effect.gen(function* () {
    const { db, installation, store, units, projectId, run, floor } = yield* world('holdingless');
    const execution = { installation, execution: ExecutionId.make('cmd-gone'), incarnation: 10 };
    yield* run(
      units.write('Terminals', (unit) =>
        Effect.gen(function* () {
          yield* store.commandRows.projectCommand(unit, {
            projectId,
            execution,
            owner: { _tag: 'Thread', thread: ThreadId.make('thread-holdingless') },
            origin: { _tag: 'Thread', thread: ThreadId.make('thread-holdingless') },
            policyIdentity: 'policy-holdingless',
            targetKey: 'k' as never,
            holdings: {},
            admittedAt: 0,
          });
          yield* unit.run(
            db.insert(commandWait()).values({
              executionId: execution.execution,
              incarnation: execution.incarnation,
              mode: 'foreground',
              revision: 0,
              movedAt: new Date(yield* Clock.currentTimeMillis),
            }),
          );
        }),
      ),
    );
    const executions = { generation: () => Effect.succeed(11), served: () => Effect.succeed(new Set<never>()) };
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }) });

    const swept = yield* run(terminals.sweepReplaced());

    expect(swept.discharged).toBe(1);
    expect([...swept.retained]).toEqual([]);
    expect(yield* run(units.read((unit) => store.commandRows.commandsStanding(unit)))).toEqual([]);
  }),
);

it.live('a holding that cannot be given back is named and the custody ends anyway', () =>
  Effect.gen(function* () {
    const { db, store, units, projectId, run, floor } = yield* world('stuck-use');
    const record: TerminalRecord = {
      ...recordAt(0),
      projectId,
      holder: principalOf({ _tag: 'Operator' }),
      origin: principalOf({ _tag: 'Operator' }),
      heldBy: ThreadId.make('thread-stuck-use'),
      holdings: { rootUse: 'use-gone' as never },
    };
    yield* run(
      units.write('Terminals', (unit) =>
        Effect.gen(function* () {
          yield* unit.run(
            db.insert(rootUse()).values({
              useId: 'use-gone',
              namespaceId: 'ns',
              path: '/stuck-use',
              consumerKind: 'terminal',
              consumerId: 'exec-1',
              mode: 'shared',
              state: 'held',
            }),
          );
          yield* store.terminalRows.project(unit, record);
        }),
      ),
    );
    const uses = {
      release: () => Effect.fail(new TerminalUnavailable({ owner: 'store', message: 'this use is no longer in the ledger' })),
    };
    const executions = { generation: () => Effect.succeed(4), served: () => Effect.succeed(new Set<never>()) };
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }) }, { uses });

    const swept = yield* run(terminals.sweepReplaced());

    expect(swept.discharged).toBe(1);
    expect([...swept.retained]).toEqual([]);
    expect(yield* run(units.read((unit) => store.terminalRows.held(unit)))).toEqual([]);
  }),
);

it.live('a sweep settles a replaced start and releases its holdings as abandoned', () =>
  Effect.gen(function* () {
    const { db, store, units, projectId, run, floor } = yield* world('replaced-start');
    const records = yield* run(fileRootStore(db, units));
    const roots = yield* run(
      rootRegistry(records, undefined as never, undefined as never, NamespaceId.make('test-recover-start'), {
        holding: () => Effect.succeed(new Map()),
      }),
    );
    const uses = yield* run(rootUseLedger(rootUseStore(db), roots, records, units));
    yield* run(
      units.write('Terminals', (unit) =>
        Effect.gen(function* () {
          yield* unit.run(
            db.insert(rootUse()).values({
              useId: 'use-replaced-start',
              namespaceId: 'test-recover-start',
              path: '/replaced-start',
              consumerKind: 'terminal',
              consumerId: 'op-replaced-start',
              mode: 'shared',
              state: 'held',
            }),
          );
          yield* unit.run(
            db.insert(terminalRequestKey()).values({
              projectId,
              operationId: 'op-replaced-start',
              requester: 'operator',
              mutation: 'start',
              targetKey: 'k',
              outcome: 'pending',
              at: new Date((yield* Clock.currentTimeMillis) - 60000),
            }),
          );
          yield* unit.run(
            db.insert(terminalIntent()).values({
              projectId,
              operationId: 'op-replaced-start',
              phase: 'dispatched',
              rootUseId: 'use-replaced-start',
              openedAt: new Date((yield* Clock.currentTimeMillis) - 60000),
            }),
          );
        }),
      ),
    );
    const executions = {
      generation: () => Effect.succeed(4),
      served: () => Effect.succeed(new Set<never>()),
      operation: () => Effect.succeed({ _tag: 'Refused', refusal: { _tag: 'IncarnationMismatch' } }),
    };
    const terminals = yield* floor({ executions: executions as never }, { uses });

    yield* run(terminals.sweepReplaced());

    const use = yield* run(units.read((unit) => rootUseStore(db).byId(UseId.make('use-replaced-start'), unit)));
    expect(use?.state).toBe('released');
    const operation = yield* run(
      units.read((unit) => unit.run(db.select({ outcome: terminalRequestKey().outcome }).from(terminalRequestKey()))),
    );
    expect(operation.map((row) => row.outcome)).toEqual(['settled']);
  }),
);

const unanswering = {
  generation: () => Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'no answer', sent: false })),
  served: () => Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'no answer', sent: false })),
};

it.live('the sweep names every retention by its own reason, with counts', () =>
  Effect.gen(function* () {
    const { run, floor } = yield* world('retention');
    const terminals = yield* floor({ executions: unanswering as never });

    expect(yield* run(terminals.sweepReplaced())).toEqual({ discharged: 0, retained: new Map() });
  }),
);

it.live('a generation nobody could read withdraws the road instead of deciding it either way', () =>
  Effect.gen(function* () {
    const { run, floor } = yield* world('unread-generation');
    const terminals = yield* floor({ executions: unanswering as never });

    expect(yield* run(terminals.dischargeReplaced(5, recordAt(0).execution))).toEqual({
      _tag: 'Retained',
      reason: 'unreadable-generation',
    });
  }),
);

it.live('the boot sweep discharges every held row of a replaced generation and leaves the standing one', () =>
  Effect.gen(function* () {
    const { installation, store, units, projectId, run, floor } = yield* world('sweep-gen');
    const held = (id: string, incarnation: number): TerminalRecord => ({
      ...recordAt(incarnation),
      projectId,
      execution: { installation, execution: ExecutionId.make(id), incarnation },
      holder: principalOf({ _tag: 'Operator' }),
      origin: principalOf({ _tag: 'Operator' }),
      heldBy: ThreadId.make('thread-sweep-gen'),
    });
    for (const row of [held('gone-0', 0), held('gone-2', 2), held('live-4', 4)]) {
      yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, row)));
    }
    const executions = { generation: () => Effect.succeed(4), served: () => Effect.succeed(new Set<never>()) };
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }) });

    const swept = yield* run(terminals.sweepReplaced());

    expect(swept.discharged).toBe(2);
    expect([...swept.retained]).toEqual([]);
    const after = yield* run(units.read((unit) => store.terminalRows.held(unit)));
    expect(after.map((row) => row.execution.execution)).toEqual([ExecutionId.make('live-4')]);
  }),
);

it.live('a re-measured ending whose survivor still stands keeps its custody, and its record is not retired', () =>
  Effect.gen(function* () {
    const { installation, store, units, projectId, run, floor } = yield* world('survivor');
    const execution = { installation, execution: ExecutionId.make('survivor-1'), incarnation: 4 };
    yield* run(
      units.write('Terminals', (unit) =>
        store.terminalRows.project(unit, {
          ...recordAt(4),
          projectId,
          execution,
          holder: principalOf({ _tag: 'Operator' }),
          origin: principalOf({ _tag: 'Operator' }),
          heldBy: ThreadId.make('thread-survivor'),
        }),
      ),
    );
    const survived = {
      execution,
      cost: { _tag: 'Measured', cpuMicros: 0, peakRssBytes: 0 },
      coverage: [],
      relation: 'partial',
      confirmed: [],
      residual: [{ kind: 'process', detail: 'process group 4242', pid: 4242, relation: 'work' }],
      unverifiable: [],
      streams: [],
      cleanup: 'residual',
      retention: 'retained',
      abandonedOutput: false,
      measurement: 'remeasured',
    };
    const retired: string[] = [];
    const executions = {
      generation: () => Effect.succeed(4),
      served: () => Effect.succeed(new Set<never>()),
      ending: () => Effect.succeed(survived),
      retire: (operation: { readonly operation: string }, ref: unknown) => {
        retired.push(operation.operation);
        return Effect.succeed({ _tag: 'Retired', execution: ref });
      },
    };
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }) });

    expect(yield* run(terminals.ended(projectId, execution, true))).toEqual({ _tag: 'Retained', reason: 'residual' });
    expect(retired).toEqual([]);
    const after = yield* run(units.read((unit) => store.terminalRows.held(unit)));
    expect(after.map((row) => row.execution.execution)).toEqual([execution.execution]);
  }),
);

it.live(
  'the disposition pass reads the mirror, proves what left it by its filed ending, keeps what the host still admits and stamps the rest',
  () =>
    Effect.gen(function* () {
      const { db, installation, store, units, projectId, run, floor } = yield* world('dispose');
      const row = (id: string, incarnation: number): TerminalRecord => ({
        ...recordAt(incarnation),
        projectId,
        execution: { installation, execution: ExecutionId.make(id), incarnation },
        holder: principalOf({ _tag: 'Operator' }),
        origin: principalOf({ _tag: 'Operator' }),
      });
      for (const record of [row('retired-4', 4), row('ended-4', 4), row('live-4', 4), row('filed-4', 4)]) {
        yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, record)));
      }
      const queued = { installation, execution: ExecutionId.make('queued-4'), incarnation: 4 };
      yield* run(
        units.write('Terminals', (unit) =>
          Effect.gen(function* () {
            yield* store.commandRows.projectCommand(unit, {
              projectId,
              execution: queued,
              owner: { _tag: 'Thread', thread: ThreadId.make('thread-queued') },
              origin: { _tag: 'Thread', thread: ThreadId.make('thread-queued') },
              policyIdentity: 'policy-queued',
              targetKey: 'k' as never,
              holdings: {},
              admittedAt: 0,
            });
            yield* unit.run(
              db.insert(commandWait()).values({
                executionId: queued.execution,
                incarnation: queued.incarnation,
                mode: 'foreground',
                revision: 0,
                movedAt: new Date(yield* Clock.currentTimeMillis),
              }),
            );
          }),
        ),
      );
      const summaryOf = (id: string, phase: string) => ({
        state: { ref: { installation, execution: ExecutionId.make(id), incarnation: 4 }, phase },
      });
      const receiptOf = (ref: { readonly execution: ExecutionId }) => ({
        execution: { installation, execution: ref.execution, incarnation: 4 },
        cost: { _tag: 'Measured', cpuMicros: 0, peakRssBytes: 0 },
        coverage: [],
        relation: 'covered',
        confirmed: [],
        residual: [],
        unverifiable: [],
        streams: [],
        cleanup: 'complete',
        retention: 'retained',
        abandonedOutput: false,
      });
      const proven = new Set<string>([ExecutionId.make('ended-4'), ExecutionId.make('filed-4')]);
      const remeasured: ExecutionId[] = [];
      const executions = {
        generation: () => Effect.succeed(4),
        served: () => Effect.succeed(new Set<never>()),
        ending: (ref: { readonly execution: ExecutionId }, remeasure?: boolean) => {
          if (remeasure === true) remeasured.push(ref.execution);
          return Effect.succeed(proven.has(ref.execution) ? receiptOf(ref) : undefined);
        },
        commandsAt: (refs: ReadonlyArray<{ readonly execution: ExecutionId }>) =>
          Effect.succeed({
            commands: refs.map((ref) => ({ state: { ref: { ...queued, execution: ref.execution }, phase: 'queued' } })),
            revision: 7,
            unmeasured: [],
          }),
        retire: (_operation: unknown, ref: unknown) => Effect.succeed({ _tag: 'Retired', execution: ref }),
      };
      let walked = 0;
      const cell = yield* terminalInventory({
        executions: {
          generation: () => Effect.succeed(4),
          served: () => Effect.succeed(new Set<never>()),
          changes: () =>
            Effect.succeed({
              _tag: 'Changed',
              revision: 7,
              executions: [summaryOf('ended-4', 'ended'), summaryOf('live-4', 'running')],
              left: [],
            }),
          list: () =>
            Effect.sync(() => {
              walked += 1;
              return { executions: [] };
            }),
          hostListeners: () => Effect.succeed(undefined),
        } as never,
      });
      const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }), cell });

      const pass = yield* run(terminals.disposition());

      expect(walked).toBe(0);
      expect(pass.stamped).toBe(1);
      expect(pass.discharged).toBe(2);
      expect([...pass.retained]).toEqual([['host-queued', 1]]);
      expect([...remeasured].sort()).toEqual(['ended-4', 'filed-4', 'queued-4', 'retired-4'].map((id) => ExecutionId.make(id)));
      const after = yield* run(units.read((unit) => store.terminalRows.standing(unit)));
      expect(after.map((entry) => entry.execution.execution)).toEqual([ExecutionId.make('live-4')]);
      const commands = yield* run(units.read((unit) => store.commandRows.commandsStanding(unit)));
      expect(commands.map((entry) => entry.execution.execution)).toEqual([queued.execution]);
    }),
);

it.live('an adoption tells the host again of every owner whose thread is gone, and only for commands of its generation', () =>
  Effect.gen(function* () {
    const { installation, store, units, projectId, run, floor } = yield* world('owners');
    for (const [id, incarnation, thread] of [
      ['gone-a', 4, 'thread-gone'],
      ['gone-b', 4, 'thread-gone'],
      ['old', 3, 'thread-old'],
    ] as const) {
      yield* run(
        units.write('Terminals.commanded', (unit) =>
          store.commandRows.projectCommand(unit, {
            projectId,
            execution: { installation, execution: ExecutionId.make(id), incarnation },
            owner: { _tag: 'Thread', thread: ThreadId.make(thread) },
            origin: { _tag: 'Thread', thread: ThreadId.make(thread) },
            policyIdentity: 'policy',
            targetKey: 'k' as never,
            holdings: {},
            admittedAt: 0,
          }),
        ),
      );
    }
    const disowned: unknown[] = [];
    const executions = {
      generation: () => Effect.succeed(4),
      served: () => Effect.succeed(new Set<never>()),
      disown: (keys: unknown) =>
        Effect.sync(() => {
          disowned.push(keys);
          return { retired: 0 };
        }),
    };
    const terminals = yield* floor({ executions: executions as never });

    yield* run(terminals.disownGone());

    expect(disowned).toEqual([{ owner: 'thread:thread-gone' }]);
  }),
);

it.live('a deleted project and deleted threads are disowned by their scope and owner keys', () =>
  Effect.gen(function* () {
    const disowned: unknown[] = [];
    const executions = {
      disown: (keys: unknown) =>
        Effect.sync(() => {
          disowned.push(keys);
          return { retired: 0 };
        }),
    };
    const terminals = yield* bare({ executions: executions as never });

    yield* Effect.andThen(terminals.disownThreads(['t-1', 't-2']), terminals.disownProject(7));

    expect(disowned).toEqual([{ owner: 'thread:t-1' }, { owner: 'thread:t-2' }, { scope: 'project:7' }]);
  }),
);

it.live('a command the host could not read by reference is kept standing, never stamped retired', () =>
  Effect.gen(function* () {
    const { db, installation, store, units, projectId, run, floor } = yield* world('unread');
    const queued = { installation, execution: ExecutionId.make('unread-4'), incarnation: 4 };
    yield* run(
      units.write('Terminals', (unit) =>
        Effect.gen(function* () {
          yield* store.commandRows.projectCommand(unit, {
            projectId,
            execution: queued,
            owner: { _tag: 'Thread', thread: ThreadId.make('thread-unread') },
            origin: { _tag: 'Thread', thread: ThreadId.make('thread-unread') },
            policyIdentity: 'policy-unread',
            targetKey: 'k' as never,
            holdings: {},
            admittedAt: 0,
          });
          yield* unit.run(
            db.insert(commandWait()).values({
              executionId: queued.execution,
              incarnation: queued.incarnation,
              mode: 'foreground',
              revision: 0,
              movedAt: new Date(yield* Clock.currentTimeMillis),
            }),
          );
        }),
      ),
    );
    const executions = {
      generation: () => Effect.succeed(4),
      served: () => Effect.succeed(new Set<never>()),
      ending: () => Effect.succeed(undefined),
      commandsAt: () =>
        Effect.succeed({
          commands: [],
          revision: 7,
          unmeasured: [{ region: 'the 1 references this batch asked about', detail: 'the store could not be read' }],
        }),
    };
    const cell = yield* terminalInventory({
      executions: {
        generation: () => Effect.succeed(4),
        served: () => Effect.succeed(new Set<never>()),
        changes: () => Effect.succeed({ _tag: 'Changed', revision: 7, executions: [], left: [] }),
        hostListeners: () => Effect.succeed(undefined),
      } as never,
    });
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }), cell });

    const pass = yield* run(terminals.disposition());

    expect(pass.stamped).toBe(0);
    expect([...pass.retained]).toEqual([['host-unmeasured', 1]]);
    const commands = yield* run(units.read((unit) => store.commandRows.commandsStanding(unit)));
    expect(commands.map((entry) => entry.execution.execution)).toEqual([queued.execution]);
  }),
);

it.live('a start interrupted inside its reservation gives the environment use back', () =>
  Effect.gen(function* () {
    const released: unknown[] = [];
    const acquired = {
      admitted: {
        target: {
          projectId: 5,
          binding: { environmentId: 'env-1', namespaceId: 'machine' },
          footprint: { resource: { path: '/tmp/work' }, roots: [] },
        },
        admission: { covered: [], footprint: { resource: { path: '/tmp/work' }, roots: [] } },
      },
      acquired: {
        use: { _tag: 'Retained', use: { useId: 'use-1' } },
        commandEnvironment: { materialize: () => Effect.succeed({ PATH: '/usr/bin' }) },
      },
    };
    const entered = yield* Deferred.make<void>();
    const units = {
      read: (work: (unit: unknown) => unknown) => work({ run: (query: unknown) => query }),
      write: () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never),
    };
    const environments = {
      releaseUse: (useId: string, _consumer: unknown, evidence: string) => {
        released.push({ useId, evidence });
        return Effect.void;
      },
    };
    const { floor } = yield* world('interrupted');
    const terminals = yield* floor(
      {
        targets: { acquire: () => Effect.succeed(acquired) } as never,
        requestKeys: { operation: () => Effect.succeed({ _tag: 'Unknown' }) } as never,
      },
      { environments, units: units as never },
    );

    const started = yield* Effect.forkChild(
      Effect.scoped(
        terminals.start({
          actor: { _tag: 'Operator' },
          operationId: HostRequestKey.make('probe-interrupt'),
          target: acquired.admitted.target,
          targetKey: 'k',
          program: '/bin/echo',
          args: [],
          transport: 'pipes',
          lifetime: 'call',
        } as never),
      ),
    );
    yield* Deferred.await(entered);
    yield* Fiber.interrupt(started);

    expect(released).toEqual([{ useId: 'use-1', evidence: 'never-applied' }]);
  }),
);

const completeReceipt = (execution: TerminalRecord['execution'], cleanup: string, measurement?: string) =>
  ({
    execution,
    measurement,
    cost: { _tag: 'Measured', cpuMicros: 0, peakRssBytes: 0 },
    coverage: [],
    relation: 'covered',
    confirmed: [],
    residual: [],
    unverifiable: [],
    streams: [],
    cleanup,
    retention: 'retained',
    abandonedOutput: false,
  }) as never;

it.live('a discharged execution gives back every interactive grant held over it', () =>
  Effect.gen(function* () {
    const { store, units, projectId, run, floor } = yield* world('granted');
    const record: TerminalRecord = {
      ...recordAt(0),
      projectId,
      holder: principalOf({ _tag: 'Operator' }),
      origin: principalOf({ _tag: 'Operator' }),
    };
    yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, record)));
    const executions = {
      closeBinding: (binding: unknown) => Effect.succeed({ _tag: 'Unbound', binding }),
      retire: (_operation: unknown, ref: unknown) => Effect.succeed({ _tag: 'Retired', execution: ref }),
    };
    const grants = grantBook({ executions: executions as never });
    yield* grants.mint(
      {
        projectId,
        execution: record.execution,
        actor: principalOf({ _tag: 'Operator' }),
        targetKey: record.targetKey,
        binding: 'binding-1' as never,
        permissionRevision: 0,
      },
      'view',
    );
    expect(grants.over(projectId, record.execution)).toHaveLength(1);
    const terminals = yield* floor({ executions: executions as never, grants });

    const discharged = yield* run(terminals.discharge(projectId, record.execution, completeReceipt(record.execution, 'complete')));

    expect(discharged).toEqual({ _tag: 'Discharged' });
    expect(grants.over(projectId, record.execution)).toEqual([]);
  }),
);

it.live(
  'Take over presents the displaced holder’s own principal, opens no lane, and mints nothing when the host’s answer is uncertain',
  () =>
    Effect.gen(function* () {
      const { installation, store, units, projectId, run, floor } = yield* world('taken-over');
      const record: TerminalRecord = {
        ...recordAt(0),
        projectId,
        holder: Principal.make('foreign:devin:session-1'),
        origin: Principal.make('foreign:devin:session-1'),
      };
      yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, record)));
      const presented: string[] = [];
      const executions = {
        openBinding: () => Effect.die(new Error('a transfer opens no lane')),
        custody: (request: { readonly act: { readonly holder: string } }, principal: string) =>
          Effect.sync(() => {
            presented.push(`${principal}->${request.act.holder}`);
            return {
              _tag: 'Uncertain',
              effect: { _tag: 'InFlight', operation: { installation, operation: HostRequestKey.make('take-over-1') } },
            };
          }),
      };
      const grants = grantBook({ executions: executions as never });
      const terminals = yield* floor({
        executions: executions as never,
        grants,
        reconciliation: { projection: () => Effect.succeed(record) } as never,
      });

      const answer = yield* run(
        terminals.takeOver({
          actor: { _tag: 'Operator' },
          projectId,
          operationId: HostRequestKey.make('take-over-1'),
          execution: record.execution,
        }),
      );

      expect(answer._tag).toBe('Uncertain');
      expect(presented).toEqual([`${record.holder}->operator`]);
      expect(grants.counts()).toEqual({ view: 0, harness: 0, agent: 0 });
    }),
);

it.live(
  'a Take over the host answered as uncertain owes its notice once the host’s custody moved past the revision it was decided over',
  () =>
    Effect.gen(function* () {
      const { installation, store, units, projectId, run, floor } = yield* world('owed');
      const agent = Principal.make('thread:agent-1');
      const record: TerminalRecord = { ...recordAt(0), projectId, holder: agent, origin: agent };
      yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, record)));
      let hostRevision = 0;
      const executions = {
        custody: () =>
          Effect.succeed({
            _tag: 'Uncertain',
            effect: { _tag: 'InFlight', operation: { installation, operation: HostRequestKey.make('take-over-2') } },
          }),
        state: () =>
          Effect.sync(() => ({
            custody: { revision: hostRevision, holder: hostRevision === 0 ? agent : 'operator' },
          })),
      };
      const terminals = yield* floor({
        executions: executions as never,
        grants: grantBook({ executions: executions as never }),
        reconciliation: { projection: () => Effect.succeed(record) } as never,
      });
      yield* run(
        terminals.takeOver({
          actor: { _tag: 'Operator' },
          projectId,
          operationId: HostRequestKey.make('take-over-2'),
          execution: record.execution,
        }),
      );
      const [intent] = yield* run(terminals.pendingNotices(10));

      expect(intent).toMatchObject({ thread: 'agent-1', state: 'intent' });
      expect(yield* run(terminals.noticeDecided(intent!))).toEqual({ _tag: 'Undecided' });
      hostRevision = 5;
      expect(yield* run(terminals.noticeDecided(intent!))).toMatchObject({
        _tag: 'Owed',
        notice: { state: 'owed', requester: UNATTRIBUTED_MOVE },
      });
      expect(yield* run(units.read((unit) => store.terminalRows.record(unit, record.execution.execution)))).toMatchObject({
        holder: 'operator',
        revision: 5,
      });
      yield* run(terminals.noticeDelivered(intent!));
      expect(yield* run(terminals.pendingNotices(10))).toEqual([]);
    }),
);

it.live('a reference at the standing generation is left to the host', () =>
  Effect.gen(function* () {
    const { run, floor } = yield* world('standing-generation');
    const terminals = yield* floor({
      executions: { generation: () => Effect.succeed(4), served: () => Effect.succeed(new Set<never>()) } as never,
    });

    expect(yield* run(terminals.dischargeReplaced(5, recordAt(4).execution))).toEqual({ _tag: 'Retained', reason: 'not-replaced' });
  }),
);

it.live('two sweeps racing under one name raise the fence once', () =>
  Effect.gen(function* () {
    const { projectId, run, floor } = yield* world('sweep', InstallationId.make('terminals-sweep'));
    const terminals = yield* floor({});
    const owner = { _tag: 'Thread', thread: ThreadId.make('thread-sweep-race') } as const;
    const key = sweepKeyOf(projectId, HostRequestKey.make('sweep-race'), principalOf({ _tag: 'Operator' }), [owner]);
    const sweep = () =>
      terminals.commands.stopAll(
        projectId,
        [owner],
        key,
        () => Effect.die(new Error('nothing is standing to authorize')),
        'explicit-stop',
        'signal',
      );
    const [first, second] = yield* run(Effect.all([sweep(), sweep()], { concurrency: 2 }));

    expect(Math.max(...first.fences, ...second.fences)).toBe(1);
    expect(first.stopped).toEqual([]);
    expect(second.refused).toEqual([]);
  }),
);

const raced = {
  installation: InstallationId.make('i'),
  execution: ExecutionId.make('exec-command-raced'),
  incarnation: 0,
};

const endedSummary: ExecutionSummary = {
  state: {
    ref: raced,
    transport: 'pipes',
    lifetime: 'command',
    purpose: 'command',
    phase: 'ended',
    nativeExit: { _tag: 'Code', code: 0 },
    streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
    cleanup: 'complete',
    record: 'available',
  },
  custody: {
    revision: 1,
    holder: Principal.make('thread:alpha'),
    origin: Principal.make('thread:alpha'),
    target: { environment: 'host', namespace: 'machine', cwd: '/tmp', dependencies: [] },
  },
  streams: [],
  native: { pid: 4242 },
  input: { acceptedThrough: ByteOffset.make('0'), pendingBytes: 0 },
};

const waitOver = Effect.fnUntraced(function* (
  states: readonly (ExecutionSummary | undefined)[],
  options: { phase?: 'queued' | 'ended'; deliveries?: Stream.Stream<ExecutionFeedItem, ExecutionsFailure> } = {},
) {
  let state = 0;
  const executions = {
    state: () => {
      const answer = states[Math.min(state, states.length - 1)];
      state += 1;
      return Effect.succeed(answer);
    },
    command: () => Effect.succeed({ state: { phase: options.phase ?? 'ended' } } as never),
    subscribe: () => options.deliveries ?? Stream.fail(new WireUnavailable({ kind: 'unreachable', reason: 'no state feed', sent: false })),
  };
  return yield* bare({ executions: executions as never, cell: yield* terminalInventory({ executions: executions as never }) });
});

it.live('a command that acquires and ends between the two reads is decided, never unwatchable', () =>
  Effect.gen(function* () {
    const terminals = yield* waitOver([undefined, endedSummary]);
    expect(yield* terminals.wait(raced, 1_000)).toEqual({ _tag: 'Decided', summary: endedSummary });
  }),
);

it.live('a queued command is decided by its state feed while the inventory feed is silent', () =>
  Effect.gen(function* () {
    const terminals = yield* waitOver([undefined], {
      phase: 'queued',
      deliveries: Stream.fromIterable<ExecutionFeedItem>([
        { _tag: 'State', summary: { ...endedSummary, state: { ...endedSummary.state, phase: 'running' } } },
        { _tag: 'State', summary: endedSummary },
      ]),
    });
    expect(yield* terminals.wait(raced, 100)).toEqual({ _tag: 'Decided', summary: endedSummary });
  }),
);

it.live('an exited command whose output is still being recorded is decided only once its streams close', () =>
  Effect.gen(function* () {
    const draining: ExecutionSummary = {
      ...endedSummary,
      state: { ...endedSummary.state, streams: { stdout: 'open', stderr: 'eof', pty: 'eof' } },
    };
    const terminals = yield* waitOver([draining], {
      deliveries: Stream.fromIterable<ExecutionFeedItem>([
        { _tag: 'State', summary: draining },
        { _tag: 'State', summary: endedSummary },
      ]),
    });
    expect(yield* terminals.wait(raced, 100)).toEqual({ _tag: 'Decided', summary: endedSummary });
  }),
);

it.live('a queued command ending without a child releases its waiter on the state feed ending', () =>
  Effect.gen(function* () {
    const options = {
      phase: 'queued' as 'queued' | 'ended',
      deliveries: Stream.fromEffect(
        Effect.sync((): ExecutionFeedItem => {
          options.phase = 'ended';
          return { _tag: 'Ended', ending: 'completed' };
        }),
      ),
    };
    const terminals = yield* waitOver([undefined], options);
    expect(yield* terminals.wait(raced, 100)).toEqual({ _tag: 'Unwatchable' });
  }),
);

it.live('a command that ended without ever acquiring a child stays unwatchable', () =>
  Effect.gen(function* () {
    const terminals = yield* waitOver([undefined]);
    expect(yield* terminals.wait(raced, 1_000)).toEqual({ _tag: 'Unwatchable' });
  }),
);

it.live('a re-measured ending whose survivors are gone is discharged, and the recorded reading it came from is not', () =>
  Effect.gen(function* () {
    const { installation, store, units, projectId, run, floor } = yield* world('residual');
    const execution = { installation, execution: ExecutionId.make('residual-1'), incarnation: 4 };
    const record: TerminalRecord = {
      ...recordAt(4),
      projectId,
      execution,
      holder: principalOf({ _tag: 'Operator' }),
      origin: principalOf({ _tag: 'Operator' }),
      heldBy: ThreadId.make('thread-residual'),
    };
    yield* run(units.write('Terminals', (unit) => store.terminalRows.project(unit, record)));
    const recorded = {
      execution,
      cost: { _tag: 'Measured', cpuMicros: 0, peakRssBytes: 0 },
      coverage: [],
      relation: 'partial',
      confirmed: [],
      residual: [{ kind: 'process', detail: 'process group 4242', pid: 4242, relation: 'work' }],
      unverifiable: [],
      streams: [],
      cleanup: 'residual',
      retention: 'retained',
      abandonedOutput: false,
    };
    const asked: boolean[] = [];
    const retired: string[] = [];
    const executions = {
      generation: () => Effect.succeed(4),
      served: () => Effect.succeed(new Set<never>()),
      ending: (_ref: unknown, remeasure?: boolean) => {
        asked.push(remeasure === true);
        return Effect.succeed(remeasure === true ? { ...recorded, residual: [], measurement: 'remeasured' } : recorded);
      },
      retire: (operation: { readonly operation: string }, ref: unknown) => {
        retired.push(operation.operation);
        return Effect.succeed({ _tag: 'Retired', execution: ref });
      },
    };
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }) });

    const stale = yield* run(terminals.ended(projectId, execution));
    const fresh = yield* run(terminals.ended(projectId, execution, true));

    expect(stale).toEqual({ _tag: 'Retained', reason: 'incomplete-cleanup' });
    expect(fresh).toEqual({ _tag: 'Discharged' });
    expect(asked).toEqual([false, true]);
    expect(retired).toEqual([]);
    expect(yield* run(units.read((unit) => store.terminalRows.held(unit)))).toEqual([]);
  }),
);

it.live('a re-measured ending with no survivors releases its holdings as abandoned', () =>
  Effect.gen(function* () {
    const { db, store, units, projectId, run, floor } = yield* world('abandoned');
    const records = yield* run(fileRootStore(db, units));
    const roots = yield* run(
      Effect.gen(function* () {
        return yield* rootRegistry(records, yield* FileSystem.FileSystem, yield* Path.Path, NamespaceId.make('test-discharge'), {
          holding: () => Effect.succeed(new Map()),
        });
      }),
    );
    const uses = yield* run(rootUseLedger(rootUseStore(db), roots, records, units));
    const record: TerminalRecord = {
      ...recordAt(0),
      projectId,
      holder: principalOf({ _tag: 'Operator' }),
      origin: principalOf({ _tag: 'Operator' }),
      heldBy: ThreadId.make('thread-abandoned'),
      holdings: { rootUse: 'use-abandoned-1' as never },
    };
    yield* run(
      units.write('Terminals', (unit) =>
        Effect.gen(function* () {
          yield* unit.run(
            db.insert(rootUse()).values({
              useId: 'use-abandoned-1',
              namespaceId: 'test-discharge',
              path: '/abandoned',
              consumerKind: 'terminal',
              consumerId: 'op-abandoned-1',
              mode: 'shared',
              state: 'held',
            }),
          );
          yield* unit.run(
            db.insert(terminalRequestKey()).values({
              projectId,
              operationId: 'op-abandoned-1',
              requester: 'operator',
              mutation: 'start',
              targetKey: 'k',
              executionId: record.execution.execution,
              incarnation: 0,
              outcome: 'settled',
              at: new Date(yield* Clock.currentTimeMillis),
            }),
          );
          yield* store.terminalRows.project(unit, record);
        }),
      ),
    );
    const executions = {
      closeBinding: (binding: unknown) => Effect.succeed({ _tag: 'Unbound', binding }),
      retire: (_operation: unknown, ref: unknown) => Effect.succeed({ _tag: 'Retired', execution: ref }),
    };
    const terminals = yield* floor({ executions: executions as never, grants: grantBook({ executions: executions as never }) }, { uses });

    const discharged = yield* run(
      terminals.discharge(projectId, record.execution, completeReceipt(record.execution, 'residual', 'remeasured')),
    );

    expect(discharged).toEqual({ _tag: 'Discharged' });
    expect(yield* run(units.read((unit) => rootUseStore(db).byId(UseId.make('use-abandoned-1'), unit)))).toBeNull();
    expect(yield* run(units.read((unit) => store.terminalRows.held(unit)))).toEqual([]);
  }),
);
