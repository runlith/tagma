import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect, FileSystem, Layer } from 'effect';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from '../../Bindings';
import { Custodian } from '../../Custodian';
import { ExecutionCapacity } from '../../ExecutionCapacity';
import { ExecutionRegistry } from '../../registry/ExecutionRegistry';
import { Executions } from '../../registry/launch';
import { InputLanes, PaceControl } from '../../registry/control';
import { ExecutionStop } from '../../registry/stops';
import { HostLifecycle } from '../../registry/shutdown';
import { HostByteRecords, TerminalScreen } from '../../registry/reads';
import type { HostClaim } from '../../registry/state';
import { connectionOf, keyOf, principalOf, registrationOf } from '../../hostFixture';
import { hostState } from '../../hostState';
import { hostSpawner } from '../../hostSpawner';
import { testHolder } from '../../posix/testing/holder';
import { runtimeProfile } from '../../runtimeFixture';
import { Processes, type ProcessReader } from '../../ProcessReader';
import { ProcessControl } from '../../ProcessControl';

export const launch = (program: string, args: readonly string[]): LaunchRequest => ({
  command: {
    program,
    args,
    environment: [
      { name: 'PATH', value: '/usr/bin:/bin' },
      { name: 'TERM', value: 'xterm-256color' },
      { name: 'PS1', value: '' },
    ],
    cwd: '/tmp',
  },
  transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: principalOf('principal-operator'),
  origin: principalOf('principal-operator'),
  budget: {},
});
type TerminalWorld = {
  readonly hostExecutions: Executions['Service'];
  readonly lanes: InputLanes['Service'];
  readonly stops: ExecutionStop['Service'];
  readonly byteRecords: HostByteRecords['Service'];
  readonly screens: TerminalScreen['Service'];
  readonly pacing: PaceControl['Service'];
  readonly bindings: Bindings['Service'];
  readonly claim: HostClaim;
  readonly processes: ProcessReader;
  readonly control: ProcessControl['Service'];
};
type TerminalCase<A, E, R> = { readonly body: (world: TerminalWorld) => Effect.Effect<A, E, R>; readonly executions?: number };
export const withTerminalHost = Effect.fnUntraced(
  function* <A, E, R>({ body, executions = 1 }: TerminalCase<A, E, R>) {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-terminal-' });
    const state = hostState(`${directory}/executions.sqlite`, registrationOf(directory), yield* sharedPool).pipe(
      Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ transports: ['pty'], rows: 40, columns: 120, executions }))),
    );
    const layer = ExecutionRegistry.layer().pipe(
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(state),
      Layer.provideMerge(testHolder(directory)),
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const custodian = yield* Custodian;
        const lifecycle = yield* HostLifecycle;
        const connection = connectionOf('connection-terminal');
        const taken = yield* custodian.take(keyOf('take-terminal'), 0, connection, 'custodian');
        const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const ended = yield* lifecycle.shutdown(claim, keyOf('shutdown-terminal'));
            if (ended._tag !== 'ShutdownComplete') return yield* Effect.die(new Error(`shutdown: ${JSON.stringify(ended)}`));
          }),
        );
        return yield* body({
          hostExecutions: yield* Executions,
          lanes: yield* InputLanes,
          stops: yield* ExecutionStop,
          byteRecords: yield* HostByteRecords,
          screens: yield* TerminalScreen,
          pacing: yield* PaceControl,
          bindings: yield* Bindings,
          claim,
          processes: yield* Processes,
          control: yield* ProcessControl,
        });
      }),
    ).pipe(Effect.provide(layer));
  },
  Effect.provide(hostSpawner),
  Effect.provide(BunServices.layer),
);
