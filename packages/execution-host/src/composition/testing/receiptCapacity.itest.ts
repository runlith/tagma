import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Holder } from '../../holder/Holder';
import { testHolder } from '../../posix/testing/holder';
import { withoutHandles } from '../../posix/testing/handles';
import { ExecutionRegistry } from '../../registry/ExecutionRegistry';
import { Executions } from '../../registry/launch';
import { ExecutionStop } from '../../registry/stops';
import type { HostClaim } from '../../registry/state';
import { Custodian } from '../../Custodian';
import { Bindings } from '../../Bindings';
import { ExecutionCapacity } from '../../ExecutionCapacity';
import { hostState } from '../../hostState';
import { hostSpawner } from '../../hostSpawner';
import { runtimeProfile } from '../../runtimeFixture';
import { connectionOf, hostTestRoot, keyOf, principalOf, registrationOf } from '../../hostFixture';

it.live(
  'logic EMFILE refuses capacity, keeps the holder, and accepts a launch after handles return',
  Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = hostTestRoot();
    yield* fs.makeDirectory(root, { recursive: true });
    const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'receipt-capacity-' });
    const profile = runtimeProfile({ executions: 2, transports: ['pipes'] });
    let exhausting = true;
    const holder = Layer.effect(
      Holder,
      Effect.map(Holder, (real) =>
        Holder.of({
          ...real,
          get held() {
            return real.held;
          },
          launch: (spec) => (exhausting ? withoutHandles(real.launch(spec)) : real.launch(spec)),
        }),
      ),
    ).pipe(Layer.provideMerge(testHolder(directory)));
    const state = hostState(`${directory}/executions.sqlite`, registrationOf(directory), yield* sharedPool).pipe(
      Layer.provideMerge(ExecutionCapacity.layer(profile)),
    );
    const registry = ExecutionRegistry.layer().pipe(
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(state),
      Layer.provideMerge(holder),
      Layer.provideMerge(hostSpawner),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const executions = yield* Executions;
        const custodian = yield* Custodian;
        const connection = connectionOf('receipt-capacity');
        const taken = yield* custodian.take(keyOf('take-capacity'), 0, connection, 'custodian');
        const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
        const principal = principalOf('capacity-contract');
        const launch: LaunchRequest = {
          command: { program: '/bin/cat', args: [], environment: [], cwd: directory },
          transport: { _tag: 'pipes', stdin: 'pipe' },
          lifetime: 'call',
          purpose: 'command',
          target: { environment: 'test', namespace: 'test', cwd: directory, dependencies: [] },
          holder: principal,
          origin: principal,
        };
        const refused = yield* executions.start(claim, keyOf('saturated'), launch);
        expect(refused._tag).toBe('Refused');
        if (refused._tag !== 'Refused') return yield* Effect.die(new Error(JSON.stringify(refused)));
        expect(refused.refusal).toMatchObject({ _tag: 'CapacityExceeded' });
        exhausting = false;
        yield* (yield* Holder).ready;
        const started = yield* executions.start(claim, keyOf('room-returned'), launch);
        expect(started._tag).toBe('Started');
        if (started._tag !== 'Started') return yield* Effect.die(new Error(JSON.stringify(started)));
        const stops = yield* ExecutionStop;
        yield* stops.stop(claim, keyOf('end-capacity'), started.execution.execution, 'explicit-stop', 'destroy');
      }),
    ).pipe(Effect.provide(registry));
  }, Effect.provide(BunServices.layer)),
);
