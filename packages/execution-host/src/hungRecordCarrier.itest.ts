import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { join } from 'node:path';
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer } from 'effect';
import { JOURNAL_FILE, segmentFile } from '@runlith/executions/recordFormat';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { InputLanes } from './registry/control';
import { HostLifecycle } from './registry/shutdown';
import type { HostClaim } from './registry/state';
import { connectionOf, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';
import { faulty, type Fault } from './testing/faultyFiles';

type World = {
  readonly executions: Executions['Service'];
  readonly lanes: InputLanes['Service'];
  readonly lifecycle: HostLifecycle['Service'];
  readonly bindings: Bindings['Service'];
  readonly claim: HostClaim;
};

const hosted = Effect.fnUntraced(
  function* <A, E, R>(transport: 'pipes' | 'pty', fault: Fault, body: (world: World) => Effect.Effect<A, E, R>) {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'hung-carrier-' });
    const state = hostState(join(directory, 'executions.sqlite'), registrationOf(directory), yield* sharedPool).pipe(
      Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ transports: [transport], rows: 40, columns: 120, executions: 1 }))),
    );
    const registry = ExecutionRegistry.layer().pipe(
      Layer.provide(Layer.succeed(FileSystem.FileSystem, faulty(files, fault))),
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(state),
      Layer.provideMerge(testHolder(directory)),
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const connection = connectionOf('hung-carrier');
        const taken = yield* (yield* Custodian).take(keyOf('hung-carrier-take'), 0, connection, 'custodian');
        return yield* body({
          executions: yield* Executions,
          lanes: yield* InputLanes,
          lifecycle: yield* HostLifecycle,
          bindings: yield* Bindings,
          claim: { connection, epoch: taken.standing.epoch, role: 'custodian' },
        });
      }),
    ).pipe(Effect.provide(registry));
  },
  Effect.provide(hostSpawner),
  Effect.provide(BunServices.layer),
);

const principal = principalOf('hung-carrier');
const target = { environment: 'e', namespace: 'n', cwd: '/tmp', dependencies: [] };

it.live(
  'a command whose stdout write never answers is released once its process exits, its stdout ended in error',
  () =>
    Effect.gen(function* () {
      const held = yield* Deferred.make<void>();
      const summary = yield* hosted(
        'pipes',
        { whenPathHas: join('stdout', segmentFile(0n)), onCall: 2, held },
        Effect.fnUntraced(function* ({ executions, claim }) {
          const launch: LaunchRequest = {
            command: { program: '/bin/sh', args: ['-c', "printf 'kept\\n'"], environment: [] },
            transport: { _tag: 'pipes', stdin: 'ignore' },
            lifetime: 'command',
            purpose: 'command',
            target,
            holder: principal,
            origin: principal,
            admission: {
              origin: { scope: 'project-1', owner: 'tester', cohort: 'wave-1' },
              limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
              policyIdentity: 'policy-1',
            },
          };
          const started = yield* executions.start(claim, keyOf('hung-command'), launch);
          if (started._tag !== 'Started' && started._tag !== 'Accepted')
            return yield* Effect.die(new Error(`the command did not start: ${started._tag}`));
          const execution = started.execution.execution;
          for (;;) {
            const moved = yield* executions.inventoryChanged();
            const change = yield* Effect.exit(executions.changed(execution));
            if (Exit.isSuccess(change)) yield* change.value;
            else if (yield* executions.settingUp(execution)) yield* moved;
            else break;
          }
          return yield* executions.summary(execution);
        }),
      );
      expect(summary?.state).toMatchObject({ phase: 'ended', streams: { stdout: 'error', stderr: 'eof' } });
    }),
  20_000,
);

it.live(
  'a host yields while a resize waits on a grid journal write that never answers',
  () =>
    Effect.gen(function* () {
      const held = yield* Deferred.make<void>();
      const entered = yield* Deferred.make<void>();
      const outcome = yield* hosted(
        'pty',
        { whenPathHas: JOURNAL_FILE, onCall: 2, held, entered },
        Effect.fnUntraced(function* ({ executions, lanes, lifecycle, bindings, claim }) {
          const started = yield* executions.start(claim, keyOf('hung-grid'), {
            command: { program: '/bin/sleep', args: ['30'], environment: [{ name: 'TERM', value: 'xterm-256color' }], cwd: '/tmp' },
            transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
            lifetime: 'held',
            purpose: 'command',
            target,
            holder: principal,
            origin: principal,
            budget: {},
          });
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`the terminal did not start: ${started._tag}`));
          const binding = yield* bindings.open(principal, claim.connection, claim.epoch);
          const resizing = yield* Effect.forkChild(
            lanes.admit(
              started.execution.execution,
              { binding: binding.id, principal, connection: claim.connection, epoch: claim.epoch },
              { sequence: 0, cause: 'resize', act: { _tag: 'Resize', geometry: { rows: 30, columns: 100 } } },
            ),
          );
          yield* Deferred.await(entered);
          const quiesced = yield* lifecycle.quiesce(claim, keyOf('hung-grid-quiesce'));
          if (quiesced._tag === 'Refused') return yield* Effect.die(new Error(`quiesce refused: ${quiesced.refusal._tag}`));
          const yielded = yield* lifecycle.yield(quiesced.ticket);
          yield* lifecycle.departed;
          return { yielded, resized: yield* Fiber.join(resizing) };
        }),
      );
      expect(outcome.yielded._tag).toBe('Yielding');
      expect(outcome.resized).toMatchObject({ _tag: 'InputUnsupported', act: 'resize', reason: 'unreadable' });
    }),
  20_000,
);
