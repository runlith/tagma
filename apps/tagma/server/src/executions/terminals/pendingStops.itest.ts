import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Clock, Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { HostRefused, WireUnavailable } from '@runlith/executions/Executions';
import { CustodyRevision, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, HostRequestKey, InstallationId, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { OperationAnswer } from '@runlith/executions/protocol/runtime';
import type { StopPrevention, StopReceipt } from '@runlith/executions/protocol/stop';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { project } from '../../projects/store/table.js';
import { TerminalRequests, Terminals } from '../contract/service/terminals.js';
import { ManagedCommands, type CommandAuthority } from '../contract/service/commands.js';
import type { StopPreparation } from '../contract/service/access.js';
import { commandWait } from '../store/terminal.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { TargetKey } from '../contract/wire/targets.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';
import { floorServices, hostTerminals, unreadHost } from '../testing/doubles.js';
import { storesOver } from '../testing/stores.js';
import { waitersOver } from '../testing/waitersFixture.js';

const installation = InstallationId.make('pending-stops');
const requester = Principal.make('operator');
const storage = Layer.unwrap(
  Effect.map(sharedPool, (pool) =>
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
    ),
  ),
);

const fixture = Effect.gen(function* () {
  const context = yield* Layer.build(storage);
  const { db } = Context.get(context, MachineStore);
  const units = Context.get(context, MachineUnits);
  const stores = storesOver(db, installation);
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const [created] = yield* units.write('pendingStops.project', (unit) =>
    unit.run(db.insert(project).values({ name: 'stops', repoKey: '/stops', rootPath: '/stops', createdAt }).returning({ id: project.id })),
  );
  const projectId = created!.id;
  const record: TerminalRecord = {
    projectId,
    execution: { installation, execution: ExecutionId.make('runner'), incarnation: 1 },
    transport: 'pipes',
    lifetime: 'held',
    targetKey: TargetKey.make('runner-target'),
    holder: requester,
    origin: requester,
    revision: CustodyRevision.make(1),
    holdings: {},
    acceptedAt: 0,
  };
  yield* units.write('pendingStops.record', (unit) => stores.terminalRows.project(unit, record));
  const key: TerminalOperationKey = {
    projectId,
    operationId: HostRequestKey.make('halt-runner'),
    requester,
    mutation: 'stop',
    targetKey: record.targetKey,
    execution: record.execution,
  };
  const receipt: StopReceipt = {
    operation: { installation, operation: key.operationId },
    execution: record.execution,
    requested: 'signal',
    cause: 'explicit-stop',
    steps: ['interrupt'],
    cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the host boundary supplies no process accounting' },
    coverage: [],
    relation: 'leader',
    confirmed: [],
    residual: [],
    unverifiable: [],
    streams: [],
    cleanup: 'complete',
    retention: 'retained',
    abandonedOutput: false,
  };
  const beforeHost = yield* Deferred.make<void>();
  const admit = yield* Deferred.make<void>();
  let answer: Effect.Effect<OperationAnswer, WireUnavailable> = Effect.succeed({ _tag: 'Unanswered', operation: receipt.operation });
  let prevention: Effect.Effect<StopPrevention, WireUnavailable | HostRefused> | undefined;
  const port = {
    ...unreadHost,
    generation: () => Effect.succeed(1),
    preventStop: (operation: HostRequestRef) =>
      Effect.suspend(() => prevention ?? Effect.succeed({ _tag: 'Prevented' as const, operation })),
    operation: (operation: HostRequestRef) =>
      Effect.map(
        Effect.suspend(() => answer),
        (answer) => (answer._tag === 'Unanswered' ? { ...answer, operation } : answer),
      ),
    stop: () => Deferred.succeed(beforeHost, undefined).pipe(Effect.andThen(Deferred.await(admit)), Effect.as(receipt)),
  };
  const owner = Effect.gen(function* () {
    const floor = yield* hostTerminals({
      installation,
      ...stores,
      executions: port,
      writers: null,
      waiters: yield* waitersOver(stores.deliveries),
    }).pipe(Effect.provide(floorServices()), Effect.provideService(SessionIdentity, { prefix: {}, extras: [] }));
    return { terminals: Terminals.of(floor), requests: TerminalRequests.of(floor), commands: ManagedCommands.of(floor.commands) };
  }).pipe(Effect.provide(context));
  const authority: CommandAuthority<StopPreparation> = {
    prepared: {
      request: { _tag: 'Stop', actor: { _tag: 'Operator' }, scope: projectId, execution: record.execution },
      targetKey: record.targetKey,
      subjects: [],
      origin: null,
      owner: { _tag: 'Operator' },
      ownerStanding: null,
      ownerFence: 1,
      lineage: null,
      relation: 'operator',
      policyIdentity: 'policy',
    },
    recheck: () => Effect.void,
  };
  const sweepKey: TerminalOperationKey = { ...key, operationId: HostRequestKey.make('sweep'), execution: undefined };
  return {
    projectId,
    key,
    receipt,
    beforeHost,
    admit,
    owner,
    predecessorKey: units
      .write('pendingStops.predecessor', (unit) =>
        stores.requestKeys.register(unit, { ...key, operationId: HostRequestKey.make('old-server-halt') }),
      )
      .pipe(Effect.as(HostRequestKey.make('old-server-halt'))),
    hostAnswers: (next: typeof answer) =>
      Effect.sync(() => {
        answer = next;
      }),
    hostPrevents: (next: NonNullable<typeof prevention>) =>
      Effect.sync(() => {
        prevention = next;
      }),
    stop: (terminals: Terminals['Service']) => terminals.stop(projectId, key, record.execution, record.revision, 'explicit-stop', 'signal'),
    stopCommand: (commands: ManagedCommands['Service']) =>
      commands.stop(projectId, key, record.execution, authority, 'explicit-stop', 'signal'),
    command: units.write('pendingStops.command', (unit) =>
      Effect.gen(function* () {
        yield* stores.commandRows.projectCommand(unit, {
          projectId,
          execution: record.execution,
          owner: { _tag: 'Operator' },
          origin: { _tag: 'Operator' },
          policyIdentity: 'policy',
          targetKey: record.targetKey,
          holdings: {},
          admittedAt: 0,
        });
        yield* unit.run(
          db.insert(commandWait).values({
            executionId: record.execution.execution,
            incarnation: record.execution.incarnation,
            mode: 'foreground',
            revision: 0,
            movedAt: new Date(yield* Clock.currentTimeMillis),
          }),
        );
      }),
    ),
    sweepKey,
    sweep: (commands: ManagedCommands['Service']) =>
      commands.stopAll(projectId, [{ _tag: 'Operator' }], sweepKey, () => Effect.succeed(authority), 'explicit-stop', 'signal'),
  };
});

it.live('a successor resolves an interrupted pre-admission stop from the host instead of keeping its pending key', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const old = yield* held.owner;
    const stopping = yield* Effect.forkChild(held.stop(old.terminals));
    yield* Deferred.await(held.beforeHost);
    yield* Fiber.interrupt(stopping);
    const successor = yield* held.owner;
    const answer = yield* successor.requests.request(held.projectId, held.key.operationId);
    expect(answer._tag).toBe('Settled');
    if (answer._tag !== 'Settled') return;
    expect(answer.stop).toBeUndefined();
    expect(yield* successor.requests.retention()).toMatchObject({ pending: 0, uncertain: 0, settled: 1 });
    const predecessor = yield* held.predecessorKey;
    const recovered = yield* successor.requests.request(held.projectId, predecessor);
    expect(recovered._tag).toBe('Settled');
    if (recovered._tag === 'Settled') expect(recovered.stop).toBeUndefined();
  }),
);

it.live('reading a live stop before host admission preserves the dispatch and then returns its receipt', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const owner = yield* held.owner;
    const stopping = yield* Effect.forkChild(held.stop(owner.terminals));
    yield* Deferred.await(held.beforeHost);
    expect((yield* owner.requests.request(held.projectId, held.key.operationId))._tag).toBe('Pending');
    yield* Deferred.succeed(held.admit, undefined);
    expect(yield* Fiber.join(stopping)).toEqual(held.receipt);
    expect(yield* owner.requests.request(held.projectId, held.key.operationId)).toMatchObject({
      _tag: 'Settled',
      stop: held.receipt,
    });
  }),
);

it.live('an interrupted sweep leaves its parent uncertain without treating an unanswered aggregate key as proof of absence', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    yield* held.command;
    const owner = yield* held.owner;
    const sweeping = yield* Effect.forkChild(held.sweep(owner.commands));
    yield* Deferred.await(held.beforeHost);
    yield* Fiber.interrupt(sweeping);
    const successor = yield* held.owner;
    expect(yield* successor.requests.request(held.projectId, held.sweepKey.operationId)).toMatchObject({
      _tag: 'Uncertain',
      effect: { _tag: 'InFlight', operation: { installation, operation: held.sweepKey.operationId } },
    });
  }),
);

it.live('an interrupted command stop is uncertain until the host proves its outcome, and an unread host never proves absence', () =>
  Effect.gen(function* () {
    const held = yield* fixture;
    const old = yield* held.owner;
    const stopping = yield* Effect.forkChild(held.stopCommand(old.commands));
    yield* Deferred.await(held.beforeHost);
    yield* Fiber.interrupt(stopping);
    expect(yield* old.requests.retention()).toMatchObject({ pending: 0, uncertain: 1, settled: 0 });
    const successor = yield* held.owner;
    const unknown = { _tag: 'InFlight', operation: held.receipt.operation } as const;
    yield* held.hostAnswers(Effect.succeed({ _tag: 'Uncertain', effect: unknown }));
    expect(yield* successor.requests.request(held.projectId, held.key.operationId)).toMatchObject({ _tag: 'Uncertain', effect: unknown });
    const unavailable = new WireUnavailable({ kind: 'unreachable', reason: 'the host connection closed', sent: false });
    yield* held.hostAnswers(Effect.fail(unavailable));
    expect(yield* Effect.flip(successor.requests.request(held.projectId, held.key.operationId))).toEqual(unavailable);
    expect(yield* successor.requests.retention()).toMatchObject({ pending: 0, uncertain: 1, settled: 0 });
    yield* held.hostAnswers(Effect.succeed({ _tag: 'Unanswered', operation: held.receipt.operation }));
    const unsupported = new HostRefused({ refusal: { _tag: 'UnsupportedCapability', capability: 'prevent-stop', reason: 'older host' } });
    yield* held.hostPrevents(Effect.fail(unsupported));
    const predecessor = yield* held.predecessorKey;
    expect(yield* Effect.flip(successor.requests.request(held.projectId, predecessor))).toEqual(unsupported);
    expect(yield* successor.requests.retention()).toMatchObject({ pending: 0, uncertain: 2, settled: 0 });
  }),
);
