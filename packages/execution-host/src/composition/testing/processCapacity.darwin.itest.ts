import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer, PlatformError } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { ExecutionCapacity } from '../../ExecutionCapacity';
import { fixtureFacts, fixtureMachine, hostProfile } from '../../hostFixture';
import { hostSpawner } from '../../hostSpawner';
import { PS } from '../../posix/macos/evidence';
import { readStanding } from '../../posix/macos/standing';
import { loadLibrary } from '../../posix/Library';
import { HOLDER_LIBRARY } from '../../posix/testing/holder';

const limits = { probeMs: 2_000, outputBytes: 262_144, errorBytes: 8_192 };
const profile = hostProfile({ executions: 2, transports: ['pipes'] });
const oneSpareProcess = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, (real) => {
    let occupied = false;
    return ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.suspend(() =>
            occupied
              ? PlatformError.systemError({
                  _tag: 'Unknown',
                  module: 'ChildProcess',
                  method: 'spawn',
                  syscall: 'fork',
                  description: 'the fixture UID reached RLIMIT_NPROC=2',
                  cause: { code: 'EAGAIN' },
                })
              : Effect.sync(() => {
                  occupied = true;
                }),
          ),
          () =>
            Effect.sync(() => {
              occupied = false;
            }),
        );
        return yield* real.spawn(
          command._tag === 'StandardCommand' && command.command === PS
            ? ChildProcess.make(process.execPath, ['-e', 'console.log(process.ppid); console.log(process.pid);'], {
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
              })
            : command._tag === 'StandardCommand' && command.args.includes('/dev/ptmx')
              ? ChildProcess.make(process.execPath, ['-e', 'console.log("p1\\nf3");'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
              : command,
        );
      }),
    );
  }),
).pipe(Layer.provide(hostSpawner));

layer(Layer.mergeAll(oneSpareProcess, BunFileSystem.layer, ExecutionCapacity.layer(profile)), { excludeTestServices: true })(
  'a census under the process ceiling',
  (it) => {
    it.effect(
      'leaves the last nproc place available for one execution',
      Effect.fnUntraced(function* () {
        const standing = yield* readStanding(limits, process.pid, yield* loadLibrary(HOLDER_LIBRARY));
        const capacity = yield* ExecutionCapacity;
        const counted = yield* capacity.initialize(
          fixtureFacts(profile, 2, {
            ...fixtureMachine(profile, 2),
            limits: { openFiles: 'absent', holderFiles: 'absent', terminals: 'absent', processes: 2 },
            standing,
          }),
        );
        yield* capacity.reserve(ExecutionId.make('last'), 'pipes');
        const refused = yield* Effect.flip(capacity.reserve(ExecutionId.make('beyond'), 'pipes'));
        expect(standing.processes).toBe(1);
        expect(standing.terminals).toBe(1);
        expect(counted.executions).toBe(1);
        expect((yield* capacity.ledger()).executions).toBe(1);
        expect(refused._tag).toBe('CapacityRefused');
        if (refused._tag === 'CapacityRefused') expect(refused.budget).toBe('host.executions');
      }),
    );
  },
);
