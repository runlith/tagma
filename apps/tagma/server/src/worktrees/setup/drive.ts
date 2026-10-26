import { Effect, Exit, FiberSet, FileSystem, Path, type Scope } from 'effect';
import { type Flight, flight } from '@runlith/held/Flight';
import type { HoldStalled, ReentrantCall } from '@runlith/held/failures';
import { Git } from '@runlith/git/Git';
import { actingGit } from '../../platform/git/ownGit.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { worktree } from '../store/tables.js';
import { Settings } from '../../settings/contract/service/values.js';
import { worktreeSetupCopy, worktreeSetupRun } from '../contract/wire/settings.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { WorktreeSetupDetail, WorktreeSetupStatus } from '../contract/wire/rows.js';
import { SetupCommands } from '../contract/service/setup.js';
import type { SetupEnding } from '../../executions/contract/wire/setup.js';
import { type WorktreeRecord, WorktreeRecords } from '../contract/service/worktrees.js';
import { copyIgnored } from '../../workspace/checkouts/ignoredCopy.js';

const UNSETTLED: ReadonlySet<WorktreeSetupStatus> = new Set(['pending', 'running']);

const said = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

const detail = (over: Partial<WorktreeSetupDetail>): WorktreeSetupDetail => ({
  step: null,
  operation: null,
  execution: null,
  reason: null,
  ...over,
});

const exited = (ending: Extract<SetupEnding, { readonly _tag: 'Exited' }>): string =>
  `The setup command exited with status ${ending.exitCode}${ending.tail === '' ? '.' : `:\n${ending.tail}`}`;

export const setupOperation = (rootId: RootId): string => `worktree-setup/${rootId}`;

export type SetupFlights = Flight<RootId, void, StoreFailure>;

export type SetupWaitFailure = StoreFailure | HoldStalled | ReentrantCall;

export const setupFlights: Effect.Effect<SetupFlights, never, Scope.Scope> = flight({
  name: 'worktrees/setup',
  owner: 'worktrees',
  key: (rootId: RootId) => rootId,
  ceiling: '15 minutes',
});

export type WorktreeSetups = {
  readonly onSettled: (listener: (projectId: number) => void) => () => void;
  readonly start: (rootId: RootId) => void;
  readonly reading: (rootId: RootId) => Effect.Effect<WorktreeRecord | null, StoreFailure>;
  readonly resume: () => Effect.Effect<void, StoreFailure>;
  readonly ready: (rootId: RootId) => Effect.Effect<WorktreeRecord | null, SetupWaitFailure>;
};

export const makeWorktreeSetups = Effect.fnUntraced(function* (input: { readonly settled?: (rootId: RootId) => Effect.Effect<void> } = {}) {
  const { settled } = input;
  const units = yield* MachineUnits;
  const records = yield* WorktreeRecords;
  const settings = yield* Settings;
  const git = actingGit(yield* Git, 'worktree-setup');
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const commands = yield* SetupCommands;
  const flights = yield* setupFlights;
  const fork = yield* FiberSet.makeRuntime<never, void, never>();
  const told = new Set<(projectId: number) => void>();

  const settle = (record: WorktreeRecord, from: WorktreeSetupStatus, to: WorktreeSetupStatus, next: WorktreeSetupDetail | null) =>
    units
      .write(writes('WorktreeSetups.settle', [worktree]), (unit) => records.settle(record.rootId, from, to, next, unit))
      .pipe(
        Effect.tap((moved) =>
          Effect.sync(() => {
            if (moved && settled !== undefined) fork(settled(record.rootId));
            if (moved && from !== to) for (const listener of told) listener(record.projectId);
          }),
        ),
      );

  const ended = Effect.fn('WorktreeSetups.ended')(function* (record: WorktreeRecord, opened: WorktreeSetupDetail, ending: SetupEnding) {
    const execution = ending.execution ?? opened.execution;
    const base = { ...opened, step: 'run' as const, execution };
    if (ending._tag === 'Exited' && ending.exitCode === 0) {
      yield* settle(record, 'running', 'done', { ...base, reason: null });
      return;
    }
    const reason = ending._tag === 'Exited' ? exited(ending) : ending.said;
    yield* settle(record, 'running', 'failed', { ...base, reason });
  });

  const prepare = Effect.fn('WorktreeSetups.prepare')(function* (record: WorktreeRecord) {
    const read = yield* Effect.all([
      settings.read(worktreeSetupCopy, record.projectId),
      settings.read(worktreeSetupRun, record.projectId),
    ]).pipe(Effect.result);
    if (read._tag === 'Failure') {
      yield* settle(
        record,
        'pending',
        'failed',
        detail({
          reason: `This project's setup settings could not be read: ${said(read.failure)}`,
        }),
      );
      return;
    }
    const [patterns, run] = read.success;
    const command = run.value.trim();
    const copied = yield* copyIgnored(git, files, paths, record.path, record.path, patterns.value).pipe(Effect.result);
    if (copied._tag === 'Failure') {
      yield* settle(record, 'pending', 'failed', detail({ step: 'copy', reason: copied.failure }));
      return;
    }
    if (command === '') {
      yield* settle(record, 'pending', copied.success > 0 ? 'done' : 'none', null);
      return;
    }
    const opened = detail({ step: 'run', operation: setupOperation(record.rootId) });
    if (!(yield* settle(record, 'pending', 'running', opened))) return;
    let seen = opened;
    const ending = yield* commands.run({
      projectId: record.projectId,
      cwd: record.path,
      command,
      operation: setupOperation(record.rootId),
      started: (execution) => {
        seen = { ...opened, execution };
        return Effect.asVoid(settle(record, 'running', 'running', seen));
      },
    });
    yield* ended(record, seen, ending);
  });

  const drive = Effect.fn('WorktreeSetups.drive')(function* (rootId: RootId) {
    const record = yield* units.read((unit) => records.byRoot(rootId, unit));
    if (record === null) return;
    if (record.setup === 'pending') return yield* prepare(record);
    if (record.setup !== 'running') return;
    const execution = record.setupDetail?.execution ?? null;
    if (execution === null) {
      yield* settle(
        record,
        'running',
        'failed',
        detail({
          ...record.setupDetail,
          step: 'run',
          reason: 'This server stopped while the setup command was being started, so whether it ran is unknown.',
        }),
      );
      return;
    }
    yield* ended(record, record.setupDetail ?? detail({ step: 'run' }), yield* commands.watch(record.projectId, execution));
  });

  const driven = (rootId: RootId): Effect.Effect<void, SetupWaitFailure> => flights.join(rootId, drive(rootId));

  const start = (rootId: RootId): void => {
    const driving = driven(rootId);
    fork(
      Effect.gen(function* () {
        const ending = yield* Effect.exit(driving);
        if (Exit.isFailure(ending)) yield* Effect.logWarning('a worktree setup could not be driven', { rootId, cause: ending.cause });
      }),
    );
  };

  const setups: WorktreeSetups = {
    onSettled: (listener) => {
      told.add(listener);
      return () => {
        told.delete(listener);
      };
    },
    start,
    reading: (rootId) => units.read((unit) => records.byRoot(rootId, unit)),
    resume: Effect.fn('WorktreeSetups.resume')(function* () {
      const unsettled = yield* units.read((unit) => records.unsettled(unit));
      for (const record of unsettled) start(record.rootId);
    }),
    ready: Effect.fn('WorktreeSetups.ready')(function* (rootId: RootId): Effect.fn.Return<WorktreeRecord | null, SetupWaitFailure> {
      const record = yield* units.read((unit) => records.byRoot(rootId, unit));
      if (record === null || !UNSETTLED.has(record.setup)) return record;
      yield* driven(rootId);
      return yield* units.read((unit) => records.byRoot(rootId, unit));
    }),
  };
  return setups;
});
