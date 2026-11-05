import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { Effect, FileSystem, Path, Scope, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { makeCheckoutPathService } from '../checkouts/paths.js';
import { CheckoutPaths } from '../contract/service/checkoutPaths.js';
import { Coverage, FileRoots, RootReservations } from '../contract/service/roots.js';
import { ThreadLineage } from '../contract/service/assignments.js';
import { Repositories } from '../contract/service/repositories.js';
import { EnvironmentBackends, type EnvironmentBackend, Environments } from '../contract/service/environments.js';
import { CheckoutWatch } from '../contract/service/watch.js';
import { CheckoutRows } from '../contract/service/checkouts.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { type ProjectRoot, ProjectRootsUnavailable } from '../contract/wire/coverage.js';
import { RootId } from '../contract/wire/ids.js';
import type { PlacedPath } from '../contract/wire/place.js';
import { makeAssignmentLedger } from '../assignments/membership.js';
import { makeGitCheckoutReads } from '../checkouts/reads.js';
import { makeGitCheckoutRows } from '../checkouts/rows.js';
import { type CheckoutWatchOptions, makeCheckoutWatches } from '../watch/shared.js';
import { makeEnvironmentLedger } from '../environments/access.js';
import { makeBackendRegistry } from '../environments/backends.js';
import { type EnvironmentUses, makeEnvironmentUses } from '../environments/uses.js';
import { makeCoveredRepositoryReader } from '../repositories/listing.js';
import { makeRepositoryRegistry } from '../repositories/registry.js';
import { workingBindings as workingBindingsFn } from '../roots/bindings.js';
import { makeCoverageLedger } from '../roots/coverage.js';
import { makeHostRootProver, unprovenRoots as unprovenRootsValue } from '../roots/proof.js';
import { makeRootRegistry } from '../roots/registry.js';
import { makeRootUseLedger } from '../roots/uses.js';
import { type AssignmentStore, makeAssignmentStore } from '../store/assignments.js';
import { type CoverageStore, makeCoverageStore } from '../store/coverage.js';
import { makeEnvironmentStore } from '../store/environments.js';
import { type EnvironmentUseStore, makeEnvironmentUseStore } from '../store/environmentUses.js';
import { makeRepositoryStore, type RepositoryStore } from '../store/repositories.js';
import { type FileRootStore, makeFileRootStore } from '../store/rootRegistry.js';
import { assignmentSelection as assignmentSelectionTable, rootUse as rootUseTable } from '../store/tables.js';
import { makeRootUseStore, type RootUseStore } from '../store/uses.js';

export const rootRegistry = (
  store: FileRootStore,
  files: FileSystem.FileSystem,
  paths: Path.Path,
  namespaceId: NamespaceId,
  reservations: RootReservations['Service'],
) =>
  makeRootRegistry({ store, namespaceId }).pipe(
    Effect.provideService(FileSystem.FileSystem, files),
    Effect.provideService(Path.Path, paths),
    Effect.provideService(RootReservations, reservations),
  );

export const hostRootProver = (access: Environments['Service']) => Effect.provideService(makeHostRootProver, Environments, access);

export const fileRootStore = (db: StoreDb<'machine'>, units: MachineUnits['Service']) =>
  Effect.provideService(makeFileRootStore({ db }), MachineUnits, units);

export const coverageStore = (db: StoreDb<'machine'>) => makeCoverageStore({ db });

export const assignmentStore = (db: StoreDb<'machine'>) => makeAssignmentStore({ db });

export const assignmentLedger = (store: AssignmentStore, roots: FileRoots['Service'], threads: ThreadLineage['Service']) =>
  makeAssignmentLedger({ store }).pipe(Effect.provideService(FileRoots, roots), Effect.provideService(ThreadLineage, threads));

export const rootUseStore = (db: StoreDb<'machine'>) => makeRootUseStore({ db });

export const rootUseLedger = (uses: RootUseStore, roots: FileRoots['Service'], records: FileRootStore, units: MachineUnits['Service']) =>
  makeRootUseLedger({ uses, records }).pipe(Effect.provideService(FileRoots, roots), Effect.provideService(MachineUnits, units));

export const repositoryStore = (db: StoreDb<'machine'>, units: MachineUnits['Service']) =>
  Effect.provideService(makeRepositoryStore({ db }), MachineUnits, units);

export const repositoryRegistry = (
  store: RepositoryStore,
  git: Git['Service'],
  files: FileSystem.FileSystem,
  paths: Path.Path,
  namespaceId: NamespaceId,
  environment?: Record<string, string | undefined>,
) =>
  makeRepositoryRegistry({ store, namespaceId, environment }).pipe(
    Effect.provideService(Git, git),
    Effect.provideService(FileSystem.FileSystem, files),
    Effect.provideService(Path.Path, paths),
  );

export const coverageLedger = (
  projects: Projects['Service'],
  roots: FileRoots['Service'],
  repositories: Repositories['Service'],
  store: CoverageStore,
  assignments: AssignmentStore,
  units: MachineUnits['Service'],
  git: Git['Service'],
) =>
  makeCoverageLedger({ store, assignments }).pipe(
    Effect.provideService(Projects, projects),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(Repositories, repositories),
    Effect.provideService(MachineUnits, units),
    Effect.provideService(Git, git),
  );

export const coveredWorkspace = Effect.fnUntraced(function* (input: {
  readonly namespaceId: NamespaceId;
  readonly projects: Projects['Service'];
  readonly git: Git['Service'];
  readonly reservations?: RootReservations['Service'];
}) {
  const { namespaceId, projects, git } = input;
  const { db } = yield* MachineStore;
  const records = yield* makeFileRootStore({ db });
  const roots = yield* Effect.provideService(makeRootRegistry({ store: records, namespaceId }), RootReservations, {
    holding: input.reservations?.holding ?? (() => Effect.succeed(new Map())),
  });
  const repositories = yield* Effect.provideService(
    makeRepositoryRegistry({ store: yield* makeRepositoryStore({ db }), namespaceId }),
    Git,
    git,
  );
  const uses = yield* Effect.provideService(makeRootUseLedger({ uses: makeRootUseStore({ db }), records }), FileRoots, roots);
  const coverage = yield* coverageLedger(
    projects,
    roots,
    repositories,
    makeCoverageStore({ db }),
    makeAssignmentStore({ db }),
    yield* MachineUnits,
    git,
  );
  return { records, roots, repositories, uses, coverage };
});

export const backendRegistry = (backends: readonly EnvironmentBackend[]) => makeBackendRegistry({ backends });

export const environmentLedger = (backends: EnvironmentBackends['Service'], uses: EnvironmentUses, units: MachineUnits['Service']) =>
  makeEnvironmentLedger({ uses }).pipe(Effect.provideService(EnvironmentBackends, backends), Effect.provideService(MachineUnits, units));

export const environmentStore = (db: StoreDb<'machine'>) => makeEnvironmentStore({ db });

export const environmentUseStore = (db: StoreDb<'machine'>) => makeEnvironmentUseStore({ db });

export const environmentUses = (uses: EnvironmentUseStore) => makeEnvironmentUses({ uses });

export const checkoutWatches = (git: Git['Service'], roots: FileRoots['Service'], scope: Scope.Scope, options?: CheckoutWatchOptions) =>
  makeCheckoutWatches(options).pipe(
    Effect.provideService(Git, git),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(Scope.Scope, scope),
  );

export const gitCheckoutRows = (git: Git['Service'], roots: FileRoots['Service'], files: FileSystem.FileSystem, scope: Scope.Scope) =>
  Effect.flatMap(checkoutWatches(git, roots, scope), (watches) =>
    makeGitCheckoutRows.pipe(
      Effect.provideService(Git, git),
      Effect.provideService(FileRoots, roots),
      Effect.provideService(FileSystem.FileSystem, files),
      Effect.provideService(CheckoutWatch, watches),
      Effect.provideService(Scope.Scope, scope),
    ),
  );

export const unwatchedCheckouts: CheckoutRows['Service'] = CheckoutRows.of({
  read: () => Effect.die('this world reads no checkout row'),
  refresh: () => Effect.die('this world refreshes no checkout row'),
  subscribe: () => Stream.die('this world follows no checkout row'),
  follow: () => Effect.die('this world follows no checkout row'),
  mark: () => Effect.void,
  onMark: () => () => undefined,
  headMoved: () => Stream.never,
  headObserved: () => Stream.never,
  checkoutsMoved: () => Stream.never,
});

export const gitCheckoutReads = (
  coverage: Coverage['Service'],
  checkouts: CheckoutPaths['Service'],
  files: FileSystem.FileSystem,
  paths: Path.Path,
  git: Git['Service'],
) =>
  makeGitCheckoutReads.pipe(
    Effect.provideService(Coverage, coverage),
    Effect.provideService(CheckoutPaths, checkouts),
    Effect.provideService(FileSystem.FileSystem, files),
    Effect.provideService(Path.Path, paths),
    Effect.provideService(Git, git),
  );

export const coveredRepositoryReader = (
  coverage: Coverage['Service'],
  roots: FileRoots['Service'],
  repositories: Repositories['Service'],
  paths: Path.Path,
  files: FileSystem.FileSystem,
) =>
  makeCoveredRepositoryReader.pipe(
    Effect.provideService(Coverage, coverage),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(Repositories, repositories),
    Effect.provideService(Path.Path, paths),
    Effect.provideService(FileSystem.FileSystem, files),
  );

export const TEST_CHECKOUT = 'repo-root';

export const testPlace = (path: string): PlacedPath => ({ checkout: TEST_CHECKOUT, path });

export const workingBindings = (...input: Parameters<typeof workingBindingsFn>) => workingBindingsFn(...input);

export const unprovenRoots = () => unprovenRootsValue;

export const rootUse = () => rootUseTable;

export const assignmentSelection = () => assignmentSelectionTable;

export type FixedCheckout = { readonly checkout: string; readonly root: string };

export const fixedCoverage = (projectId: number, checkouts: readonly FixedCheckout[]): Coverage['Service'] => {
  const roots = checkouts.map((one, at): ProjectRoot => ({
    projectId,
    rootId: RootId.make(one.checkout),
    path: existsSync(one.root) ? realpathSync(one.root) : one.root,
    origin: at === 0 ? 'canonical' : 'worktree',
  }));
  const coverage = { projectId, namespaceId: NamespaceId.make('host'), rootPath: roots[0]?.path ?? '/', roots, withheld: [] };
  const unread = Effect.fail(
    new ProjectRootsUnavailable({ projectId, reason: 'registry', message: 'a fixed coverage takes no new roots' }),
  );
  return {
    cover: () => Effect.succeed(coverage),
    covered: () => Effect.succeed(coverage),
    survey: () => Effect.succeed(coverage),
    adopt: () => unread,
    admit: () => unread,
    follow: () => Effect.succeed(false),
    followAcross: () => Effect.succeed(false),
    coverAcross: () => Effect.succeed(false),
    onCovered: () => () => undefined,
    recorded: () => undefined,
  };
};

export const fixedCheckoutPaths = (projectId: number, checkouts: readonly FixedCheckout[]) =>
  checkoutPaths(fixedCoverage(projectId, checkouts), {
    list: () =>
      Effect.succeed([
        {
          id: projectId,
          name: 'fixed',
          repoKey: 'fixed',
          rootPath: checkouts[0]?.root ?? '/',
          createdAt: new Date(0),
          kind: 'folder' as const,
        },
      ]),
    byId: () => Effect.die('a fixed registry does not read projects'),
    named: () => Effect.die('a fixed registry does not resolve names'),
    resolve: () => Effect.die('a fixed registry does not resolve projects'),
    global: () => Effect.succeed(undefined),
    removed: () => Effect.succeed([]),
    register: () => Effect.die('a fixed registry does not register projects'),
    setRoot: () => Effect.die('a fixed registry does not move projects'),
    rename: () => Effect.die('a fixed registry does not rename projects'),
    remove: () => Effect.die('a fixed registry does not remove projects'),
    forget: () => Effect.die('a fixed registry does not forget projects'),
    registryVersion: Effect.succeed(0),
  });

export const gitCheckoutPaths = (checkout: string, projectId = 1): CheckoutPaths['Service'] => {
  const placeOf: CheckoutPaths['Service']['placeOf'] = (_projectId, path) =>
    Effect.sync(() => {
      for (let root = path; root !== dirname(root); root = dirname(root)) {
        if (!existsSync(join(root, '.git'))) continue;
        let parent = dirname(path);
        while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
        const spelled = join(realpathSync(parent), relative(parent, path));
        const real = realpathSync(root);
        if (spelled === real) return { projectId, checkout, root: real, path: '' };
        return spelled.startsWith(`${real}/`) ? { projectId, checkout, root: real, path: spelled.slice(real.length + 1) } : null;
      }
      return null;
    });
  return {
    pathWithin: () => Effect.succeed({ exists: false }),
    placeOf,
    placeAcross: (path) => placeOf(projectId, path),
    resourceAcross: (path) => placeOf(projectId, existsSync(path) ? realpathSync(path) : path),
    rootAcross: (named) =>
      Effect.map(isAbsolute(named) ? placeOf(projectId, named) : Effect.succeed(null), (place) =>
        place === null ? null : { projectId, rootId: RootId.make(place.checkout), path: place.root, origin: 'canonical' as const },
      ),
    rootsWithin: () => Effect.succeed([]),
  };
};

const unusedRoot = () => Effect.die('a fixed path fixture only answers root removal');

const fixedRoots = FileRoots.of({
  namespaceId: NamespaceId.make('fixed-paths'),
  register: unusedRoot,
  resolve: unusedRoot,
  publish: unusedRoot,
  publishAll: unusedRoot,
  read: unusedRoot,
  checked: unusedRoot,
  checkedAll: unusedRoot,
  live: unusedRoot,
  active: unusedRoot,
  scope: () => ({ resolve: unusedRoot }),
  resolveFootprint: unusedRoot,
  recheck: unusedRoot,
  retireMissing: unusedRoot,
  removed: () => Effect.succeed(false),
  locate: unusedRoot,
  probe: unusedRoot,
  matching: unusedRoot,
  relocate: unusedRoot,
});

export const checkoutPaths = (coverage: Coverage['Service'], projects: Projects['Service'], roots: FileRoots['Service'] = fixedRoots) =>
  makeCheckoutPathService.pipe(
    Effect.provideService(Coverage, coverage),
    Effect.provideService(Projects, projects),
    Effect.provideService(FileRoots, roots),
  );
