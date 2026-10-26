import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { ConnectionId } from '@runlith/executions/protocol/registration';
import { ExecutionId, InstallationId, HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionStore, executionStore } from './store/ExecutionStore';
import { INSTALLATION, fixtureHolder, hostProfile, hostTestRoot, registrationOf } from './hostFixture';

const profile = hostProfile({ executions: 1 });
const operation = (name: string): HostRequestRef => ({
  installation: InstallationId.make(INSTALLATION),
  operation: HostRequestKey.make(name),
});

it.live(
  'host custody and cancellation history outlive their admission slots, including after reopen',
  Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = hostTestRoot();
    yield* fs.makeDirectory(root, { recursive: true });
    const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'operation-capacity-' });
    const layer = executionStore(join(directory, 'executions.sqlite'), registrationOf(directory), yield* sharedPool).pipe(
      Layer.provide(fixtureHolder()),
      Layer.provideMerge(
        ExecutionCapacity.layer({
          ...profile,
          execution: { ...profile.execution, receipts: 1 },
          host: { ...profile.host, tombstones: 1, custodyReceipts: 1 },
        }),
      ),
    );
    yield* Effect.gen(function* () {
      const store = yield* ExecutionStore;
      const capacity = yield* ExecutionCapacity;
      const execution = ExecutionId.make('held');
      yield* capacity.reserve(execution, 'pipes');
      for (const n of [0, 1]) {
        expect(
          (yield* store.settle({
            operation: operation(`receipt-${n}`),
            kind: 'receipt',
            execution,
            fingerprint: `receipt-${n}`,
            receipt: { _tag: 'Accepted', execution: { installation: InstallationId.make(INSTALLATION), execution, incarnation: 0 } },
          }))._tag,
        ).toBe('Recorded');
        const accepted = yield* store.acceptCustody({
          _tag: 'Take',
          operation: operation(`take-${n}`),
          expected: n,
          connection: ConnectionId.make(`owner-${n}`),
        });
        expect(accepted.standing.revision).toBe(n + 1);
        expect(
          (yield* store.settle({
            operation: operation(`cancel-${n}`),
            kind: 'tombstone',
            fingerprint: `cancel-${n}`,
            receipt: { _tag: 'Refused', refusal: { _tag: 'AdmissionClosed', reason: 'cancelled before start' } },
          }))._tag,
        ).toBe('Recorded');
      }
      expect((yield* capacity.account()).custodyReceipts).toBe(0);
      expect((yield* capacity.account()).tombstones).toBe(0);
      expect((yield* store.operationOf(operation('cancel-0')))?.receipt).toEqual({
        _tag: 'Refused',
        refusal: { _tag: 'AdmissionClosed', reason: 'cancelled before start' },
      });
      const repeated = yield* store.acceptCustody({
        _tag: 'Take',
        operation: operation('take-0'),
        expected: 0,
        connection: ConnectionId.make('owner-0'),
      });
      expect(repeated._tag).toBe('Standing');
      if (repeated._tag === 'Standing') expect(repeated.answered.revision).toBe(1);
    }).pipe(Effect.provide(layer));
    yield* Effect.gen(function* () {
      const store = yield* ExecutionStore;
      expect(
        (yield* store.acceptCustody({
          _tag: 'Take',
          operation: operation('take-reopened'),
          expected: 2,
          connection: ConnectionId.make('owner-reopened'),
        })).standing.revision,
      ).toBe(3);
      const previousCustody = yield* Effect.flip(store.custodyAnswer(operation('take-0')));
      expect(previousCustody._tag).toBe('OperationConflict');
      const spent = yield* store.operationOf(operation('cancel-0'));
      expect(spent?.kind).toBe('tombstone');
      expect(spent?.receipt).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'IncarnationMismatch' } });
    }).pipe(Effect.provide(Layer.fresh(layer)));
  }, Effect.provide(BunFileSystem.layer)),
);
