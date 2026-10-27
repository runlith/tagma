import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { ExecutionCapacity } from '../../ExecutionCapacity';
import { fixtureFacts, fixtureMachine, hostProfile, hostTestRoot } from '../../hostFixture';
import { Holder, type HeldLaunch } from '../../holder/Holder';
import { testHolder, HOLDER_LIBRARY } from '../../posix/testing/holder';
import { loadLibrary } from '../../posix/Library';
import { readStanding } from '../../posix/macos/standing';

const limits = { probeMs: 2_000, outputBytes: 262_144, errorBytes: 8_192 };

it.live(
  'one owned PTY leaves exactly one place under a two-terminal ceiling',
  Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = hostTestRoot();
    yield* fs.makeDirectory(root, { recursive: true });
    const state = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'terminal-capacity-' });
    const profile = hostProfile({ executions: 4, transports: ['pty'] });
    const launch: HeldLaunch = {
      id: 'owned',
      path: '/bin/sh',
      argv: ['sh', '-c', 'read line'],
      env: [],
      cwd: state,
      transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
      pace: 'full',
    };
    yield* Effect.scoped(Effect.flatMap(Holder, (holder) => holder.launch(launch))).pipe(Effect.provide(testHolder(state)));
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const holder = yield* Holder;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const ownTerminals = ChildProcessSpawner.make((command) =>
          spawner.spawn(
            command._tag === 'StandardCommand' && command.args.includes('/dev/ptmx')
              ? ChildProcess.make(command.command, ['-a', '-p', `${holder.pid},${process.pid}`, ...command.args], command.options)
              : command,
          ),
        );
        const standing = readStanding(limits, holder.pid, yield* loadLibrary(HOLDER_LIBRARY)).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, ownTerminals),
        );
        const before = yield* standing;
        const child = yield* holder.launch(launch);
        yield* Effect.addFinalizer(() =>
          Effect.orDie(Effect.andThen(child.act('work', 'kill'), Effect.andThen(child.exit, Effect.andThen(child.reap, child.release)))),
        );
        const during = yield* standing;
        const capacity = yield* ExecutionCapacity;
        yield* capacity.reserve(ExecutionId.make('owned'), 'pty');
        const counted = yield* capacity.initialize(
          fixtureFacts(profile, 4, {
            ...fixtureMachine(profile, 4),
            limits: { openFiles: 'absent', holderFiles: 'absent', processes: 'absent', terminals: 2 },
            standing: during,
          }),
        );
        yield* capacity.reserve(ExecutionId.make('last'), 'pty');
        const refused = yield* Effect.flip(capacity.reserve(ExecutionId.make('beyond'), 'pty'));
        return { before, during, counted, refused, ledger: yield* capacity.ledger() };
      }),
    ).pipe(Effect.provide(testHolder(state)), Effect.provide(ExecutionCapacity.layer(profile)));
    expect(result.before.terminals).toBe(0);
    expect(result.during.terminals).toBe(1);
    expect(result.counted.terminals).toBe(2);
    expect(result.ledger.terminals).toBe(2);
    expect(result.refused._tag).toBe('CapacityRefused');
    if (result.refused._tag === 'CapacityRefused') expect(result.refused.budget).toBe('host.terminals');
  }, Effect.provide(BunServices.layer)),
);
