import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import type { Git } from '@runlith/git/Git';
import { dataPathOf, MachineStore } from '../platform/contract/service/store.js';
import type { MachineUnits } from '../platform/contract/service/units.js';
import { makeGitCheckoutRows } from './checkouts/rows.js';
import { makeCheckoutWatches } from './watch/shared.js';
import { CheckoutWatch } from './contract/service/watch.js';
import { makeGitCheckoutWrites } from './checkouts/gitWrites.js';
import { makeCheckoutPathService } from './checkouts/paths.js';
import {
  CheckoutHistory,
  type CheckoutHoldings,
  CheckoutPlaces,
  CheckoutRows,
  CheckoutWrites,
  type GraphDirectory,
} from './contract/service/checkouts.js';
import { makeGitCheckoutReads } from './checkouts/reads.js';
import { makeCoveredRepositoryReader } from './repositories/listing.js';
import { CheckoutPaths } from './contract/service/checkoutPaths.js';
import { type EnvironmentBackends, Environments } from './contract/service/environments.js';
import { Coverage, FileRoots, ProjectRootMembership, RootHoldings, RootReservations, RootUses } from './contract/service/roots.js';
import { CoveredRepositories, Repositories } from './contract/service/repositories.js';
import { WorkingOrigins } from './contract/service/places.js';
import { makeHostRootProver } from './roots/proof.js';
import { makeRootRegistry } from './roots/registry.js';
import { healRootsDaily, makeRootHealing } from './roots/healing.js';
import { makeFileRootStore } from './store/rootRegistry.js';
import { makeRepositoryRegistry } from './repositories/registry.js';
import { makeRepositoryStore } from './store/repositories.js';
import { makeRootUseLedger } from './roots/uses.js';
import { makeRootUseStore } from './store/uses.js';
import { makeEnvironmentLedger } from './environments/access.js';
import { makeEnvironmentUses } from './environments/uses.js';
import { makeEnvironmentUseStore } from './store/environmentUses.js';
import { makeCoverageLedger } from './roots/coverage.js';
import { makeCoverageStore } from './store/coverage.js';
import type { Projects } from '../projects/contract/service/registry.js';
import { CommitTrees } from './contract/service/commitTrees.js';
import { makeGitCommitTrees } from './checkouts/commitTrees.js';
import { drive } from '../platform/contract/service/drives.js';

export type WorkspaceServices =
  | Environments
  | FileRoots
  | Repositories
  | RootUses
  | Coverage
  | CheckoutRows
  | CheckoutWatch
  | WorkingOrigins
  | CheckoutPaths
  | CoveredRepositories
  | CheckoutHistory
  | CheckoutPlaces;

export const workspaceLayer: Layer.Layer<
  WorkspaceServices,
  never,
  MachineStore | MachineUnits | Projects | Git | RootReservations | RootHoldings | EnvironmentBackends
> = Layer.effectContext(
  Effect.gen(function* () {
    const { db } = yield* MachineStore;
    const access = yield* makeEnvironmentLedger({ uses: makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) }) });
    const { identity } = yield* access
      .inspect('host')
      .pipe(
        Effect.catch((refusal) =>
          Effect.die(
            `This installation has no host environment to serve under — ${refusal._tag}${'reason' in refusal ? `: ${refusal.reason}` : ''}`,
          ),
        ),
      );
    const records = yield* makeFileRootStore({ db });
    const roots = yield* makeRootRegistry({ store: records, namespaceId: identity.namespaceId });
    const repositories = yield* makeRepositoryRegistry({ store: yield* makeRepositoryStore({ db }), namespaceId: identity.namespaceId });
    const registered = Context.make(Environments, access).pipe(Context.add(FileRoots, roots), Context.add(Repositories, repositories));
    const uses = yield* Effect.provideContext(makeRootUseLedger({ uses: makeRootUseStore({ db }), records }), registered);
    const watches = yield* Effect.provideContext(makeCheckoutWatches(), registered);
    const used = registered.pipe(Context.add(RootUses, uses), Context.add(CheckoutWatch, watches));
    const checkouts = yield* Effect.provideContext(makeGitCheckoutRows, used);
    const coverage = yield* Effect.provideContext(makeCoverageLedger({ store: makeCoverageStore({ db }) }), used);
    yield* drive('root-healing', healRootsDaily(yield* Effect.provideContext(makeRootHealing({ records }), used)));
    const covered = used.pipe(Context.add(CheckoutRows, checkouts), Context.add(Coverage, coverage));
    const placed = covered.pipe(Context.add(CheckoutPaths, yield* Effect.provideContext(makeCheckoutPathService, covered)));
    const history = yield* Effect.provideContext(makeGitCheckoutReads, placed);
    return placed.pipe(
      Context.add(CoveredRepositories, yield* Effect.provideContext(makeCoveredRepositoryReader, placed)),
      Context.add(CheckoutHistory, history),
      Context.add(CheckoutPlaces, history),
      Context.add(WorkingOrigins, yield* Effect.provideContext(makeHostRootProver, placed)),
    );
  }),
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

export const checkoutWritesLayer: Layer.Layer<CheckoutWrites, never, Git | FileRoots | CheckoutRows | GraphDirectory | CheckoutHoldings> =
  Layer.effect(CheckoutWrites, makeGitCheckoutWrites);

export const projectRootMembershipLayer: Layer.Layer<ProjectRootMembership, never, MachineStore> = Layer.effect(
  ProjectRootMembership,
  Effect.map(MachineStore, ({ db }) => makeCoverageStore({ db })),
);

export const commitTreesBase = (store: MachineStore['Service']): string =>
  join(dataPathOf(store.path) ?? tmpdir(), dataPathOf(store.path) === null ? 'tagma-workspace' : 'workspace', 'commit-trees');

export const commitTreesLayer: Layer.Layer<CommitTrees, never, MachineStore> = Layer.effect(
  CommitTrees,
  Effect.gen(function* () {
    const trees = yield* makeGitCommitTrees({ base: commitTreesBase(yield* MachineStore) });
    yield* drive(
      'commit-trees-sweep',
      trees.sweep.pipe(
        Effect.tap((swept) => (swept.length === 0 ? Effect.void : Effect.logInfo('commit trees of vanished checkouts removed', { swept }))),
        Effect.tapError((failure) =>
          Effect.logWarning('commit trees of vanished checkouts could not be swept', { reason: failure.message }),
        ),
      ),
    );
    return trees;
  }),
);
