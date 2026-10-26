import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Schema } from 'effect';
import { Git } from '@runlith/git/Git';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { MachineUnits, writeUnitOf } from '../../platform/contract/service/units.js';
import { Settings } from '../../settings/contract/service/values.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { WorktreeRecords, type WorktreeRecord } from '../contract/service/worktrees.js';
import { SetupCommands } from '../contract/service/setup.js';
import { worktreeSetupCopy, worktreeSetupRun } from '../contract/wire/settings.js';
import type { SetupEnding } from '../../executions/contract/wire/setup.js';
import { makeWorktreeSetups } from './drive.js';

const EXECUTION: ExecutionRef = {
  installation: InstallationId.make('setup-test'),
  execution: ExecutionId.make('setup-execution'),
  incarnation: 0,
};
const ended = (exitCode: number): SetupEnding => ({ _tag: 'Exited', execution: EXECUTION, exitCode, tail: '' });

const fixture = Effect.fnUntraced(function* (command: string, running = false) {
  const draft = (name: string): WorktreeRecord => ({
    rootId: RootId.make(name),
    projectId: 7,
    name,
    path: `/trees/${name}`,
    branch: `work/${name}`,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    origin: name,
    hue: 0,
    setup: running ? 'running' : 'pending',
    taskId: null,
    createdAt: new Date(0),
    setupDetail: running ? { step: 'run', operation: `setup/${name}`, execution: name === 'lost' ? null : EXECUTION, reason: null } : null,
  });
  const rootId = RootId.make('ready');
  const lostId = RootId.make('lost');
  const rows = new Map([draft('ready'), draft('lost')].map((row) => [row.rootId, row]));
  const launched = yield* Deferred.make<void>();
  const release = yield* Deferred.make<SetupEnding>();
  const unit = writeUnitOf<'machine'>({
    store: { path: 'memory', generation: 1 },
    run: () => Effect.die('setup policy does not issue SQL'),
    afterCommit: (work) => work,
  });
  const services = yield* Layer.build(
    Layer.mergeAll(
      Path.layer,
      Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
      Layer.mock(Git, { run: () => Effect.die('setup with no copy patterns must not read git') }),
      Layer.mock(MachineUnits, { read: (work) => work(unit), write: (_operation, work) => work(unit) }),
      Layer.mock(WorktreeRecords, {
        byRoot: (id) => Effect.sync(() => rows.get(id) ?? null),
        unsettled: () => Effect.sync(() => [...rows.values()].filter((row) => row.setup === 'pending' || row.setup === 'running')),
        settle: (id, from, to, setupDetail) =>
          Effect.sync(() => {
            const row = rows.get(id);
            if (row === undefined || row.setup !== from) return false;
            rows.set(id, { ...row, setup: to, setupDetail });
            return true;
          }),
      }),
      Layer.mock(Settings, {
        read: (key) =>
          Schema.decodeUnknownEffect(key.schema)(
            key.id === worktreeSetupCopy.id ? [] : key.id === worktreeSetupRun.id ? command : key.fallback,
          ).pipe(
            Effect.orDie,
            Effect.map((value) => ({ value, from: 'project' as const, layers: {}, rejections: [] })),
          ),
      }),
      Layer.succeed(
        SetupCommands,
        SetupCommands.of({
          run: (launch) =>
            Effect.andThen(
              launch.started(EXECUTION).pipe(Effect.orDie),
              Effect.andThen(Deferred.succeed(launched, undefined), Deferred.await(release)),
            ),
          watch: () => Effect.succeed(ended(0)),
        }),
      ),
    ),
  );
  const setups = yield* makeWorktreeSetups().pipe(Effect.provideContext(services));
  return { setups, rootId, lostId, launched, release };
});

it.effect('the first turn waits for setup, and the command outcome settles with its execution', () =>
  Effect.gen(function* () {
    for (const status of [0, 1]) {
      const { setups, rootId, launched, release } = yield* fixture('install');
      const waiting = yield* Effect.forkChild(setups.ready(rootId));
      yield* Deferred.await(launched);
      const opened = yield* setups.reading(rootId);
      expect(opened?.setup).toBe('running');
      expect(opened?.setupDetail?.execution).toEqual(EXECUTION);
      expect(waiting.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(release, ended(status));
      const settled = yield* Fiber.join(waiting);
      expect(settled?.setup).toBe(status === 0 ? 'done' : 'failed');
      expect(settled?.setupDetail?.execution).toEqual(EXECUTION);
    }
  }),
);

it.effect('a setup with no command and no copied files settles none', () =>
  Effect.gen(function* () {
    const { setups, rootId } = yield* fixture('');
    expect((yield* setups.ready(rootId))?.setup).toBe('none');
  }),
);

it.effect('resume follows a recorded execution and refuses to invent one after interrupted startup', () =>
  Effect.gen(function* () {
    const { setups, rootId, lostId } = yield* fixture('', true);
    yield* setups.resume();
    expect((yield* setups.ready(rootId))?.setup).toBe('done');
    const lost = yield* setups.ready(lostId);
    expect(lost?.setup).toBe('failed');
    expect(lost?.setupDetail).toMatchObject({ step: 'run', execution: null, operation: 'setup/lost' });
  }),
);
