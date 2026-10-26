import { join } from 'node:path';
import { Context, type Duration, Effect, FileSystem, Layer, Path } from 'effect';
import { Git } from '@runlith/git/Git';
import { PreservationCommit } from '../../worktrees/contract/service/preservation.js';
import { writes } from '../../platform/contract/service/writes.js';
import { makeFinishingGates } from '../../worktrees/retirement/gates.js';
import { makeActProgress } from '../../worktrees/progress.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { makeFinishingGuards } from '../../worktrees/retirement/guards.js';
import { uuidv7 } from 'uuidv7';
import { ExecutionId, Incarnation, InstallationId } from '@runlith/executions/protocol/execution';
import { MachineStore } from '../../platform/contract/service/store.js';
import { retirementOver } from '../../change-record/testing/holdings.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { type DemoState, type FixtureProject, tempRepoEffect } from './graphFixture.js';
import { coverageStore } from '../../workspace/testing/doubles.js';
import { coverageLedger } from '../../workspace/testing/doubles.js';
import type { CheckoutHolder } from '../../workspace/contract/wire/checkout.js';
import { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import { MergeNotice } from '../../landing/contract/service/mergeNotice.js';
import { MergeReceipts } from '../../landing/contract/service/receipts.js';
import type { GraphSync } from '../../landing/contract/wire/merge.js';
import type { TreeDelivery } from '../../graph/contract/service/delivery.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { ProgramUnavailable } from '@runlith/github/GitHubCli';
import { type RootBinding } from '../../workspace/contract/wire/roots.js';
import { type RootId, UseId } from '../../workspace/contract/wire/ids.js';
import { environmentLedger } from '../../workspace/testing/doubles.js';
import { backendRegistry } from '../../workspace/testing/doubles.js';
import { environmentStore } from '../../workspace/testing/doubles.js';
import { environmentUseStore } from '../../workspace/testing/doubles.js';
import { environmentUses } from '../../workspace/testing/doubles.js';
import { hostEnvironment } from '../../executions/testing/doubles.js';
import type { EnvironmentResources } from '../../workspace/contract/service/environments.js';
import { assignmentStore } from '../../workspace/testing/doubles.js';
import { gitCheckoutRows } from '../../workspace/testing/doubles.js';
import { fileRootStore } from '../../workspace/testing/doubles.js';
import { rootRegistry } from '../../workspace/testing/doubles.js';
import { repositoryRegistry } from '../../workspace/testing/doubles.js';
import { makeMergeChecks } from '../../worktrees/listing/mergeChecks.js';
import { CheckDriver } from '../../worktrees/contract/service/mergeChecks.js';
import { graphDriver } from '../../enforcement/commits/graphMerge.js';
import { repositoryStore } from '../../workspace/testing/doubles.js';
import { rootUseStore } from '../../workspace/testing/doubles.js';
import { rootUseLedger } from '../../workspace/testing/doubles.js';
import { WorktreeUnavailable } from '../../worktrees/contract/wire/failures.js';
import {
  intentsOver,
  mergeCoordinator,
  mergeRequestsOver,
  mergeQueue,
  preservationOver,
  receiptsOver,
} from '../../landing/testing/doubles.js';
import { worktreeUpdates } from '../../threads/testing/doubles.js';
import {
  type LiveThread,
  type PlacedThread,
  type FinishingThreads,
  WorktreeThreads,
} from '../../worktrees/contract/service/finishingGate.js';
import type { RootEnding, RootExecution } from '../../executions/contract/service/rootExecutions.js';
import { FinishingGate, GraphDelivering, RetirementSettlement, WorktreeRetirement } from '../../worktrees/contract/service/retirement.js';
import { WorktreeIntents } from '../../worktrees/contract/service/intents.js';
import { RootEndings } from '../../worktrees/contract/service/rootEndings.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { Repositories } from '../../workspace/contract/service/repositories.js';
import { FileRoots, RootUses } from '../../workspace/contract/service/roots.js';
import { Retirement } from '../../change-record/contract/service/retirement.js';
import { branchDeletion, worktreeCreator, worktreeDeletion, worktreeStore } from '../../worktrees/testing/doubles.js';
import {
  type AfterDelivery,
  type AfterSubject,
  type CheckSubject,
  type Checked,
  UNCHECKED,
} from '../../enforcement/contract/wire/checks.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { landingStore, pendingStood } from '../../landing/testing/doubles.js';
import { landingServices, provedOrigins } from './landingServices.js';

export const shEffect = Effect.fn('finishingFixture.sh')(function* (cwd: string, args: readonly string[]) {
  const run = yield* spawnedEffect(['git', ...args], { cwd });
  if (run.exitCode !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`));
  return run.stdout.toString().trim();
});

export const commitEffect = Effect.fn('finishingFixture.commit')(function* (dir: string, name: string, text: string, message: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.writeFileString(join(dir, name), text);
  yield* shEffect(dir, ['add', '--', name]);
  yield* shEffect(dir, ['commit', '-q', '-m', message]);
});

type Running = { readonly holder: string; readonly program: string | null; readonly stuck?: boolean };

type Seen = {
  readonly archived: [string, boolean][];
  readonly placed: [string, RootBinding][];
  readonly delivered: [string, string, string][];
  readonly merged: [string, string, string][];
  readonly landed: AfterSubject[];
  readonly stopped: string[];
};

export const OPERATOR = { _tag: 'Operator' } as const;

export const refusal = <A, E extends { readonly _tag: string }>(work: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(work), (failure) => ('reason' in failure ? failure.reason : failure._tag));

export const composed = Effect.fnUntraced(
  function* (
    demo: DemoState,
    world: EnvironmentResources['world'],
    options: {
      readonly graph?: (checkout: string) => Effect.Effect<GraphSync>;
      readonly delivery?: TreeDelivery;
      readonly before?: (subject: CheckSubject) => Effect.Effect<Checked>;
      readonly cutAfterPublishing?: boolean;
      readonly gitOver?: (git: Git['Service']) => Git['Service'];
      readonly carried?: boolean;
      readonly project?: FixtureProject;
    } = {},
  ) {
    const machine = yield* MachineStore;
    const { db } = machine;
    const units = yield* MachineUnits;
    const liveGit = yield* Git;
    const services = yield* landingServices;
    const files = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'worktree-finishing-' });
    const access = yield* environmentLedger(
      backendRegistry([yield* hostEnvironment({ records: environmentStore(db), anchor, world })]),
      environmentUses(environmentUseStore(db)),
      units,
    );
    const state = yield* access.inspect('host');
    if (state.binding === null) return yield* Effect.die(new Error(`the host answered for no identity: ${state.reason}`));
    const acquired = yield* access.acquireActive({
      binding: state.binding,
      consumer: { kind: 'test', id: 'finishing' },
      requires: ['files', 'exec'],
    });
    const records = yield* worktreeStore(coverageStore(db));
    const rootRecords = yield* fileRootStore(db, units);
    const roots = yield* rootRegistry(rootRecords, files, paths, state.binding.namespaceId, records);
    const repositories = yield* repositoryRegistry(yield* repositoryStore(db, units), liveGit, files, paths, state.binding.namespaceId);
    const useStore = rootUseStore(db);
    const uses = yield* rootUseLedger(useStore, roots, rootRecords, units);
    const running = new Map<string, Running>();
    const stops: string[] = [];
    const releasedUse = (useId: string) =>
      Effect.orDie(units.read((unit) => useStore.byId(UseId.make(useId), unit))).pipe(Effect.map((use) => use?.state === 'released'));
    const ending: RootEnding = (_projectId, _rootId, _requester, found) =>
      Effect.succeed(
        found.map((use): RootExecution => {
          const one = running.get(use.useId);
          if (one === undefined) {
            return {
              use,
              shown: null,
              unreachable: 'unknown',
              end: () => Effect.fail({ message: 'unknown' }),
              discharged: Effect.succeed(false),
            };
          }
          return {
            use,
            shown: {
              kind: 'terminal',
              execution: {
                installation: InstallationId.make('test'),
                execution: ExecutionId.make(use.useId),
                incarnation: Incarnation.make(1),
              },
              program: one.program,
              holder: one.holder,
            },
            unreachable: null,
            end: Effect.fnUntraced(function* (operationId) {
              stops.push(operationId);
              if (!one.stuck)
                yield* Effect.orDie(units.write('finishingFixture.end', (unit) => useStore.release(UseId.make(use.useId), unit)));
              return true;
            }),
            discharged: releasedUse(use.useId),
          };
        }),
      );
    const hold = Effect.fnUntraced(function* (rootId: RootId, one: Running) {
      const useId = uuidv7();
      const [root] = yield* Effect.orDie(units.read((unit) => rootRecords.byIds([rootId], unit)));
      if (root === undefined) return yield* Effect.die(new Error(`no root ${rootId}`));
      yield* Effect.orDie(
        units.write('finishingFixture.hold', (unit) =>
          useStore.hold(
            {
              useId: UseId.make(useId),
              resource: { namespaceId: root.namespaceId, path: root.path },
              consumer: { kind: 'terminal', id: `start-${useId}` },
              mode: 'shared',
              state: 'held',
              roots: [{ rootId, locationRevision: root.locationRevision }],
            },
            unit,
          ),
        ),
      );
      running.set(useId, one);
      return useId;
    });
    const coverage = yield* coverageLedger(
      demo.graph.projects,
      roots,
      repositories,
      coverageStore(db),
      assignmentStore(db),
      units,
      liveGit,
    );
    const worktrees = yield* worktreeCreator({ intents: records, records, repositories, roots, git: liveGit, files, paths, units });
    const holding = new Map<string, CheckoutHolder>();
    const checkouts = yield* gitCheckoutRows(liveGit, roots, files, yield* Effect.scope);
    const holdings: CheckoutHoldings['Service'] = {
      holdersOf: (_root, asked) =>
        Effect.succeed(
          new Map(
            asked.flatMap((path) => {
              const holder = holding.get(path);
              return holder === undefined ? [] : [[path, [holder]] as const];
            }),
          ),
        ),
    };
    const standing: LiveThread[] = [];
    const placedIn: PlacedThread[] = [];
    const lookup: { fails: boolean; undelivered: string | null } = { fails: false, undelivered: null };
    const seen: Seen = { archived: [], placed: [], delivered: [], merged: [], landed: [], stopped: [] };
    const landed = landingStore(db);
    const pendingStore = landed.pending;
    const threads: FinishingThreads = {
      live: () => Effect.succeed([...standing]),
      placedIn: () =>
        lookup.fails
          ? Effect.fail(new WorktreeUnavailable({ reason: 'storage', message: 'the thread rows are unavailable' }))
          : Effect.succeed([...placedIn]),
      archive: (_projectId, threadId, archived) =>
        Effect.sync(() => {
          seen.archived.push([threadId, archived]);
        }),
      stop: (_projectId, threadId) =>
        Effect.sync(() => {
          seen.stopped.push(threadId);
          const at = standing.findIndex((one) => one.threadId === threadId);
          if (at >= 0) standing[at] = { ...standing[at]!, live: false };
        }),
      place: (threadId, root) =>
        Effect.sync(() => {
          seen.placed.push([threadId, root]);
        }),
    };
    const covered = (projectId: number) =>
      coverage.covered(projectId).pipe(
        Effect.catchTag('ProjectRootsUnavailable', (refused) =>
          refused.reason === 'unestablished' || refused.reason === 'moved' ? coverage.cover(projectId) : Effect.fail(refused),
        ),
        Effect.map((value) => value.roots),
      );
    const gates = makeFinishingGates();
    const port = {
      ...threads,
      standingRoot: () => Effect.die('the finishing fixture does not answer standingRoot'),
      placing: () => Effect.die('the finishing fixture does not answer placing'),
      threadsMoved: () => () => {},
      stopping: () => () => {},
    };
    const owned = Context.make(MachineStore, machine).pipe(
      Context.add(MachineUnits, units),
      Context.add(FileSystem.FileSystem, files),
      Context.add(WorktreeRecords, records),
      Context.add(WorktreeIntents, records),
      Context.add(FileRoots, roots),
      Context.add(RootUses, uses),
      Context.add(Repositories, repositories),
      Context.add(CheckoutRows, checkouts),
      Context.add(CheckoutHoldings, holdings),
      Context.add(WorktreeThreads, port),
      Context.add(FinishingGate, gates),
    );
    const guards = yield* makeFinishingGuards({ covered }).pipe(Effect.provideContext(owned), Effect.provideService(Git, liveGit));
    const progress = yield* makeActProgress;
    const checks = yield* makeMergeChecks.pipe(Effect.provideService(Git, liveGit), Effect.provideService(CheckDriver, graphDriver));
    const preserved = yield* Layer.build(preservationOver(Effect.void).pipe(Layer.provide(Layer.succeed(Git, liveGit))));
    const merging: Git['Service'] = options.gitOver === undefined ? liveGit : options.gitOver(liveGit);
    const deletion = yield* worktreeDeletion({
      guards,
      progress,
      branches: yield* branchDeletion({ guards, checks, progress }).pipe(Effect.provideContext(owned), Effect.provideService(Git, liveGit)),
      checks,
      announce: () => {},
    }).pipe(
      Effect.provideContext(owned),
      Effect.provideService(Git, merging),
      Effect.provideService(PreservationCommit, Context.get(preserved, PreservationCommit)),
      Effect.provideService(GraphDelivering, {
        ready: () => Effect.void,
        deliver: options.delivery ?? (() => Effect.succeed('ordinary')),
        sync: () => Effect.succeed('ordinary'),
      }),
      Effect.provideService(RetirementSettlement, landed.settlement),
      Effect.provideService(RootEndings, ending),
      Effect.provideService(CommitTrees, Context.get(services, CommitTrees)),
      Effect.provideService(Retirement, yield* retirementOver(machine, units, liveGit, roots, checkouts)),
    );
    const retirement: WorktreeRetirement['Service'] = {
      delete: deletion.delete,
      place: guards.placeOf,
      terms: (projectId, rootId, asking) =>
        Effect.zipWith(guards.placeOf(projectId, rootId, false), guards.retiring(projectId, rootId, asking), (place, consents) => ({
          ...place,
          consents,
        })),
    };
    const receipts = receiptsOver(db, units);
    const publishingGit: Git['Service'] =
      options.cutAfterPublishing !== true
        ? merging
        : {
            run: (args, runOptions) =>
              args.includes('--create-reflog') && args.some((arg) => arg.startsWith('tagma merge '))
                ? Effect.flatMap(merging.run(args, runOptions), () => Effect.die('the server stopped after the publication'))
                : merging.run(args, runOptions),
          };
    const finishing = yield* Effect.provideContext(
      mergeCoordinator(
        Context.make(Git, publishingGit).pipe(
          Context.add(WorktreeRecords, records),
          Context.add(CheckoutRows, checkouts),
          Context.add(CheckoutHoldings, holdings),
          Context.add(MachineStore, machine),
          Context.add(MachineUnits, units),
          Context.add(WorktreeThreads, port),
          Context.add(FinishingGate, gates),
          Context.add(WorktreeRetirement, retirement),
          Context.add(WorkingOrigins, provedOrigins),
          Context.add(MergeNotice, { prepare: () => Effect.succeed(null) }),
          Context.add(MergeReceipts, {
            ...receipts,
            record: (unit, projectId, receipt) =>
              Effect.andThen(
                receipts.record(unit, projectId, receipt),
                Effect.sync(() => {
                  seen.merged.push([receipt.rootId, receipt.mode, receipt.commit]);
                }),
              ),
          }),
        ),
        pendingStore,
        {
          covered,
          checks,
          guards,
          progress,
          announce: () => {},
          graph: (_projectId, checkout) => options.graph?.(checkout) ?? Effect.succeed({ status: 'synced' as const, merges: [] }),
          sync: () => Effect.succeed('ordinary' as const),
          gh: () => Effect.fail(new ProgramUnavailable({ detail: 'gh is absent in this fixture' })),
          rules: {
            before: options.before ?? (() => Effect.succeed(UNCHECKED)),
            after: (landed): Effect.Effect<AfterDelivery | void> =>
              lookup.undelivered === null
                ? Effect.sync(() => {
                    seen.landed.push(landed);
                  })
                : Effect.succeed({ delivered: false, reason: lookup.undelivered } as const),
          },
          carried: () => Effect.succeed(options.carried === true),
        },
      ),
      services,
    );
    const updates = worktreeUpdates(
      guards,
      gates,
      threads,
      (threadId, envelope) =>
        Effect.sync(() => {
          seen.delivered.push([threadId, envelope.intent, envelope.text]);
          return { status: 'woken' as const };
        }),
      () => Effect.fail({ message: 'the finishing fixture starts no thread', unblock: ['place a thread in the worktree first'] as const }),
      progress,
    );
    const project = options.project?.root ?? (yield* tempRepoEffect(demo.fixture, 'finishing-'));
    const projectId =
      options.project?.id ?? (yield* demo.graph.projectLifecycle.create({ name: paths.basename(project), rootPath: project })).id;
    yield* coverage.cover(projectId);
    const store = yield* repositories.register({ path: project, projectId });
    const trunk = yield* shEffect(project, ['symbolic-ref', '--short', 'HEAD']);
    const make = Effect.fnUntraced(function* (name: string, detached = false) {
      const operationId = RequestKey.make(name);
      yield* worktrees.prepare({
        intent: {
          operationId,
          projectId,
          repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
          destination: paths.join(paths.dirname(project), `${paths.basename(project)}-${name}`),
          mode: detached ? { kind: 'detached', start: trunk } : { kind: 'new-branch', branch: `tagma/${name}`, start: trunk },
        },
        acquired,
      });
      const made = yield* worktrees.execute({ operationId, projectId, acquired });
      if (made.rootId === null) return yield* Effect.die(new Error(`the worktree ${name} registered no root`));
      return { rootId: made.rootId as RootId, path: made.destination, branch: `tagma/${name}` };
    });
    const waiting = (retry: Duration.Input) => mergeQueue(units, pendingStore, finishing, checkouts, holdings, { retry });
    return {
      finishing,
      updates,
      retirement,
      make,
      project,
      projectId,
      trunk,
      standing,
      placedIn,
      lookup,
      seen,
      holding,
      records,
      units,
      stood: pendingStood(units, pendingStore),
      waiting,
      hold,
      stops,
      releasedUse,
    };
  },
  (effect) => effect.pipe(Effect.provide(BunFileSystem.layer), Effect.provide(Path.layer)),
);
