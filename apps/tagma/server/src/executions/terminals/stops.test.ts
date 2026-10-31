import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Layer, Queue } from 'effect';
import { Executions } from '@runlith/executions/Executions';
import { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import { ExecutionId, HostRequestKey, InstallationId } from '@runlith/executions/protocol/execution';
import { CustodyRevision, Principal } from '@runlith/executions/protocol/custody';
import type { StopReceipt } from '@runlith/executions/protocol/stop';
import { MachineUnits, writeUnitOf } from '../../platform/contract/service/units.js';
import { CommandWaiters } from '../contract/service/commands.js';
import { Discharge } from '../contract/service/discharge.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import type { TerminalOperationKey, TerminalOperationState } from '../contract/wire/requestKeys.js';
import type { TerminalRecord } from '../contract/wire/terminals.js';
import { TargetKey } from '../contract/wire/targets.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { CommandRows } from '../store/commandRows.js';
import { TerminalRows } from '../store/terminalRows.js';
import { TerminalInventory } from './inventory.js';
import { makeTerminalStops } from './stops.js';

it.effect('a repeated sweep waits for the active pass and answers its discharged commands', () =>
  Effect.gen(function* () {
    const installation = InstallationId.make('sweep');
    const execution = { installation, execution: ExecutionId.make('command'), incarnation: 1 };
    const owner = { _tag: 'Operator' } as const;
    const principal = Principal.make('operator');
    const targetKey = TargetKey.make('target');
    const key: TerminalOperationKey = {
      projectId: 1,
      operationId: HostRequestKey.make('sweep'),
      requester: principal,
      mutation: 'stop',
      targetKey,
    };
    const command: CommandRecord = {
      projectId: 1,
      execution,
      owner,
      origin: owner,
      policyIdentity: 'policy',
      targetKey,
      holdings: {},
      admittedAt: 0,
    };
    const terminal: TerminalRecord = {
      projectId: 1,
      execution,
      transport: 'pipes',
      lifetime: 'call',
      targetKey,
      holder: principal,
      origin: principal,
      revision: CustodyRevision.make(1),
      holdings: {},
      acceptedAt: 0,
    };
    const receipt: StopReceipt = {
      operation: { installation, operation: HostRequestKey.make('sweep:command') },
      execution,
      requested: 'signal',
      cause: 'run-abort',
      steps: ['interrupt'],
      cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the scripted host has no accounting' },
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
    const released = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    const secondDone = yield* Deferred.make<void>();
    const ended = yield* Queue.unbounded<typeof execution>();
    const states = new Map<HostRequestKey, Extract<TerminalOperationState, { readonly _tag: 'Pending' | 'Settled' }>>();
    let held = true;
    let hasStopped = false;
    const unit = writeUnitOf<'machine'>({
      store: { path: 'memory', generation: 1 },
      run: (query) => query,
      afterCommit: (effect) => effect,
    });
    const units = MachineUnits.of({
      read: (work) => work(unit),
      write: (_operation, work) => work(unit),
      program: () => Effect.die(new Error('the stops test runs no programs')),
      markReadOnly: (effect) => effect,
      markWrite: (effect) => effect,
    });
    const requestKeys = {
      operation: (_unit, _projectId, operation) =>
        Effect.succeed(states.get(operation) ?? { _tag: 'Unknown', operation: { installation, operation } }),
      register: (_unit, named) =>
        Effect.sync(() => {
          const state = states.get(named.operationId) ?? { _tag: 'Pending' as const, key: named };
          states.set(named.operationId, state);
          return state;
        }),
    } satisfies Partial<RequestKeys>;
    const intents = {
      settle: (_unit, _projectId, operation) =>
        Effect.sync(() => {
          const state = states.get(operation);
          if (state !== undefined && 'key' in state) states.set(operation, { _tag: 'Settled', key: state.key });
        }),
    } satisfies Partial<TerminalIntents>;
    const rows = {
      ownerFences: () => Effect.succeed([1]),
      fenceOwners: () => Effect.succeed([1]),
      commandsOwnedBy: () => Effect.sync(() => (held ? [command] : [])),
      commandIntentsOf: () => Effect.succeed([]),
    } satisfies Partial<CommandRows>;
    const discharge = Discharge.of({
      ended: () => Effect.die('the sweep reads the stop receipt'),
      discharge: () =>
        Effect.sync(() => {
          held = false;
          return { _tag: 'Discharged' as const };
        }),
      dischargeReplaced: () => Effect.succeed({ _tag: 'Retained', reason: 'not-replaced' }),
      sweepReplaced: () => Effect.die('the sweep does not replace generations'),
      retire: () => Effect.die('the sweep does not retire records'),
      disposition: () => Effect.die('the sweep does not read the inventory'),
    });
    const stops = yield* makeTerminalStops({ installation }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(MachineUnits, units),
          Layer.mock(RequestKeys, requestKeys),
          Layer.mock(TerminalIntents, intents),
          Layer.mock(CommandRows, rows),
          Layer.mock(TerminalRows, { record: () => Effect.succeed(terminal) }),
          Layer.mock(CommandWaiters, { ended }),
          Layer.mock(TerminalInventory, {
            retained: () => undefined,
            forget: () => {
              throw new Error('the sweep reads command rows');
            },
          }),
          Layer.succeed(Discharge, discharge),
          Layer.mock(ExecutionEvidence, {}),
          Layer.mock(Executions, {
            stop: () =>
              Effect.suspend(() => {
                if (hasStopped) return Effect.die('a repeated sweep must not stop the same command twice');
                hasStopped = true;
                return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(released)), Effect.as(receipt));
              }),
          }),
        ),
      ),
    );
    const sweep = stops.stopCommands(
      1,
      [owner],
      key,
      () =>
        Effect.succeed({
          prepared: {
            request: { _tag: 'Stop', actor: { _tag: 'Operator' }, scope: 1, execution },
            targetKey,
            subjects: [],
            origin: null,
            owner,
            ownerStanding: null,
            ownerFence: 1,
            lineage: null,
            relation: 'operator',
            policyIdentity: 'policy',
          },
          recheck: () => Effect.void,
        }),
      'run-abort',
      'signal',
    );
    const first = yield* Effect.forkChild(sweep, { startImmediately: true });
    yield* Deferred.await(entered);
    const second = yield* Effect.forkChild(sweep.pipe(Effect.tap(() => Deferred.succeed(secondDone, undefined))), {
      startImmediately: true,
    });
    expect(yield* Deferred.isDone(secondDone)).toBe(false);
    yield* Deferred.succeed(released, undefined);
    expect((yield* Fiber.join(first)).standing).toEqual([]);
    expect((yield* Fiber.join(second)).standing).toEqual([]);
  }),
);
