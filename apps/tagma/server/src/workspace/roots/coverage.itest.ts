import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Projects } from '../../projects/contract/service/registry.js';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Path } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { Git } from '@runlith/git/Git';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from './registry.js';
import { Coverage, FileRoots, RootReservations } from '../contract/service/roots.js';
import { Repositories } from '../contract/service/repositories.js';
import { EnvironmentBackends, Environments } from '../contract/service/environments.js';
import { makeRepositoryRegistry } from '../repositories/registry.js';
import { makeRepositoryStore } from '../store/repositories.js';
import { makeRootUseStore } from '../store/uses.js';
import { makeRootUseLedger } from './uses.js';
import { makeEnvironmentLedger } from '../environments/access.js';
import { makeBackendRegistry } from '../environments/backends.js';
import { makeEnvironmentStore } from '../store/environments.js';
import { makeEnvironmentUseStore } from '../store/environmentUses.js';
import { makeEnvironmentUses } from '../environments/uses.js';
import { executionTargets, hostEnvironment, makeMachineWorld } from '../../executions/testing/doubles.js';
import { SpawnAnnotation } from '@runlith/executions/executionSpawner';
import {
  type DemoState,
  demoGraphLayer,
  gitEffect,
  tempRepoEffect,
  tempRootEffect,
  withDemo,
} from '../../composition/testing/graphFixture.js';
import { makeCoverageStore } from '../store/coverage.js';
import { makeCoverageLedger } from './coverage.js';

const unreserved = RootReservations.of({ holding: () => Effect.succeed(new Map()) });

const machineWorld = makeMachineWorld(() => null);

const composed = Effect.fnUntraced(function* (demo: DemoState) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const liveGit = yield* Git;
  const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'project-roots-' });
  const host = yield* hostEnvironment({ records: makeEnvironmentStore({ db }), anchor, world: machineWorld });
  const access = yield* Effect.provideService(
    makeEnvironmentLedger({ uses: makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) }) }),
    EnvironmentBackends,
    makeBackendRegistry({ backends: [host] }),
  );
  const state = yield* access.inspect('host');
  if (state.binding === null) return yield* Effect.die(new Error(`the host answered for no identity: ${state.reason}`));
  const binding = state.binding;
  const acquired = yield* access.acquireActive({ binding, consumer: terminal, requires: ['files'] });
  const records = yield* makeFileRootStore({ db });
  const rootsOver = (namespaceId: NamespaceId, reservations = unreserved) =>
    Effect.provideService(makeRootRegistry({ store: records, namespaceId }), RootReservations, reservations);
  const roots = yield* rootsOver(binding.namespaceId);
  const uses = yield* Effect.provideService(makeRootUseLedger({ uses: makeRootUseStore({ db }), records }), FileRoots, roots);
  const projects = demo.graph.projects;
  const coverageOver = Effect.fnUntraced(function* (registry: FileRoots['Service'], gitOf: Git['Service']) {
    const repositories = yield* Effect.provideService(
      makeRepositoryRegistry({ store: yield* makeRepositoryStore({ db }), namespaceId: registry.namespaceId }),
      Git,
      gitOf,
    );
    const coverage = yield* makeCoverageLedger({ store: makeCoverageStore({ db }) }).pipe(
      Effect.provideService(Projects, projects),
      Effect.provideService(FileRoots, registry),
      Effect.provideService(Repositories, repositories),
      Effect.provideService(Git, gitOf),
    );
    return { repositories, coverage };
  });
  return { db, units, files, acquired, access, roots, uses, projects, rootsOver, coverageOver, ...(yield* coverageOver(roots, liveGit)) };
});

const projectOf = (demo: DemoState, rootPath: string) =>
  Effect.map(demo.graph.projectLifecycle.create({ name: `other-${rootPath.split('/').pop() ?? 'project'}`, rootPath }), (row) => row.id);

const terminal = { kind: 'terminal', id: 'target-one' };
const other = { kind: 'terminal', id: 'target-two' };

layer(demoGraphLayer().pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, Path.layer))), { excludeTestServices: true })(
  'project roots',
  (it) => {
    it.effect('coverage is established before a footprint inside a project may be reserved', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { units, uses, coverage, acquired, roots, files } = yield* composed(demo);
          const inside = join(demo.demoRoot, 'apps');
          yield* files.makeDirectory(inside, { recursive: true });
          const unestablished = yield* Effect.flip(
            coverage.admit({ projectId: demo.projectId, footprint: yield* roots.resolveFootprint(inside), acquired }),
          );
          expect(unestablished._tag).toBe('ProjectRootsUnavailable');
          if (unestablished._tag === 'ProjectRootsUnavailable') expect(unestablished.reason).toBe('unestablished');
          const established = yield* coverage.cover(demo.projectId);
          expect(established.rootPath).toBe(demo.demoRoot);
          expect(established.roots.map((root) => root.origin)).toContain('canonical');
          const bare = established.roots[0];
          if (bare === undefined) return yield* Effect.die(new Error('the coverage established no root'));
          expect((yield* roots.checked(bare.rootId)).git).toBe(null);
          const admission = yield* coverage.admit({
            projectId: demo.projectId,
            footprint: yield* roots.resolveFootprint(inside),
            acquired,
          });
          expect(admission.footprint.roots.map(({ root }) => root.rootId)).toEqual(established.roots.map((root) => root.rootId));
          expect(admission.covered.map((root) => root.rootId)).toEqual(established.roots.map((root) => root.rootId));
          const use = yield* units.write('ProjectRoots.use', (unit) =>
            uses.reserve(unit, { footprint: admission.footprint, consumer: terminal, mode: 'shared' }),
          );
          expect(use.roots.map((root) => root.rootId)).toEqual(established.roots.map((root) => root.rootId));
          const disruptive = yield* coverage.admit({
            projectId: demo.projectId,
            footprint: yield* roots.resolveFootprint(demo.demoRoot),
            acquired,
          });
          const refused = yield* Effect.flip(
            units.write('ProjectRoots.refused', (unit) =>
              uses.reserve(unit, { footprint: disruptive.footprint, consumer: other, mode: 'disruptive' }),
            ),
          );
          expect(refused._tag).toBe('RootUseRefused');
          if (refused._tag === 'RootUseRefused') expect(refused.uses.map((held) => held.useId)).toEqual([use.useId]);
        }),
      ),
    );

    it.effect('support commands retain one root admission per tool act and the next act resolves anew', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { roots, coverage, access, acquired, files } = yield* composed(demo);
          yield* coverage.cover(demo.projectId);
          const targets = yield* Effect.provide(
            executionTargets(),
            Context.make(Environments, access).pipe(Context.add(FileRoots, roots), Context.add(Coverage, coverage)),
          );
          const request = { projectId: demo.projectId, kind: 'host' as const, cwd: demo.demoRoot };
          const call = { correlation: 'one-bash-baseline' };
          const first = yield* targets.resolve(request).pipe(Effect.provideService(SpawnAnnotation, call));
          const elsewhere = yield* files.makeTempDirectoryScoped({ prefix: 'other-admission-' });
          yield* roots.register({ path: elsewhere, provenance: { kind: 'test', id: 'unrelated' } });
          const continued = yield* targets.resolve(request).pipe(Effect.provideService(SpawnAnnotation, call));
          expect(continued.footprint.roots).toEqual(first.footprint.roots);
          expect(
            (yield* coverage.admit({ projectId: demo.projectId, acquired, footprint: first.footprint })).footprint.registryRevision,
          ).toBe(continued.footprint.registryRevision);
          const nested = join(demo.demoRoot, 'nested');
          yield* files.makeDirectory(nested);
          const added = yield* roots.register({ path: nested, provenance: { kind: 'test', id: 'nested' } });
          const stale = yield* Effect.flip(targets.resolve(request).pipe(Effect.provideService(SpawnAnnotation, call)));
          expect(stale._tag).toBe('RootConflict');
          if (stale._tag === 'RootConflict') expect(stale.reason).toBe('resource-changed');
          const next = yield* targets.resolve(request).pipe(Effect.provideService(SpawnAnnotation, { correlation: 'next-bash-baseline' }));
          expect(next.footprint.roots.map(({ root }) => root.rootId)).toContain(added.rootId);
          const refused = yield* Effect.flip(coverage.admit({ projectId: demo.projectId, acquired, footprint: first.footprint }));
          expect(refused._tag).toBe('RootConflict');
        }),
      ),
    );

    it.effect('every checkout of one repository covers one store, and another clone is another store', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { coverage, repositories, roots } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'store-');
          const project = yield* projectOf(demo, checkout);
          const worktree = join(yield* tempRootEffect(demo.fixture, 'worktree-'), 'linked');
          yield* gitEffect(checkout, ['worktree', 'add', '-q', worktree]);
          const covered = yield* coverage.cover(project);
          expect(covered.roots.map((root) => root.origin).sort()).toEqual(['canonical', 'worktree']);
          const facets = yield* Effect.forEach(covered.roots, (root) => roots.checked(root.rootId));
          const linked = facets.map((root) => root.git);
          expect(new Set(linked.map((facet) => facet?.repositoryId)).size).toBe(1);
          expect(new Set(linked.map((facet) => facet?.gitDirectory.path)).size).toBe(2);
          for (const facet of linked) expect(facet === null || 'commonDirectory' in facet).toBe(false);
          const first = linked[0];
          if (first === undefined || first === null) return yield* Effect.die(new Error('the coverage carried no worktree facet'));
          const store = yield* repositories.read(first.repositoryId);
          expect(store.repository.commonDirectory).toBe(join(checkout, '.git'));
          const clone = yield* tempRepoEffect(demo.fixture, 'clone-');
          const otherCover = yield* coverage.cover(yield* projectOf(demo, clone));
          const otherRoot = otherCover.roots[0];
          if (otherRoot === undefined) return yield* Effect.die(new Error('the second project covered nothing'));
          expect((yield* roots.checked(otherRoot.rootId)).git?.repositoryId).not.toBe(first.repositoryId);
        }),
      ),
    );

    it.effect('a survey takes the coverage again when git holds a checkout the record does not name', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { coverage, files } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'survey-');
          const project = yield* projectOf(demo, checkout);
          const established = yield* coverage.cover(project);
          expect(established.roots.length).toBe(1);
          const linked = join(yield* tempRootEffect(demo.fixture, 'survey-linked-'), 'added');
          yield* gitEffect(checkout, ['worktree', 'add', '-q', linked]);
          expect((yield* coverage.covered(project)).roots.length).toBe(1);
          const surveyed = yield* coverage.survey(project);
          expect(surveyed.roots.map((root) => root.path)).toContain(yield* files.realPath(linked));
          expect((yield* coverage.covered(project)).roots.length).toBe(2);
        }),
      ),
    );

    it.effect('a survey of a project rooted in a directory that is no checkout answers its coverage', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { coverage, files } = yield* composed(demo);
          const established = yield* coverage.cover(demo.projectId);
          const surveyed = yield* coverage.survey(demo.projectId);
          expect(surveyed.roots.map((root) => root.rootId)).toEqual(established.roots.map((root) => root.rootId));
        }),
      ),
    );

    it.effect('a directory that becomes a checkout gains its link on the next reconciliation', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { coverage, roots, files } = yield* composed(demo);
          const plain = yield* coverage.cover(demo.projectId);
          const root = plain.roots[0];
          if (root === undefined) return yield* Effect.die(new Error('the coverage established no root'));
          expect((yield* roots.checked(root.rootId)).git).toBe(null);
          yield* gitEffect(demo.demoRoot, ['init', '-q']);
          yield* gitEffect(demo.demoRoot, ['config', 'user.email', 'tagma@test']);
          yield* gitEffect(demo.demoRoot, ['config', 'user.name', 'tagma']);
          yield* gitEffect(demo.demoRoot, ['commit', '-q', '--allow-empty', '-m', 'seed']);
          const again = yield* coverage.cover(demo.projectId);
          expect(again.roots.map((covered) => covered.rootId)).toContain(root.rootId);
          const linked = (yield* roots.checked(root.rootId)).git;
          expect(linked?.gitDirectory.path).toBe(join(yield* files.realPath(demo.demoRoot), '.git'));
          expect((yield* coverage.cover(demo.projectId)).roots.length).toBe(again.roots.length);
        }),
      ),
    );

    it.effect('a repository whose checkouts cannot be listed refuses the coverage rather than stamping one root', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { acquired, roots, coverageOver } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'unlistable-');
          const project = yield* projectOf(demo, checkout);
          const liveGit = yield* Git;
          const mute = Git.of({
            run: (args, options) =>
              args.includes('worktree') && args.includes('list')
                ? Effect.succeed({
                    status: 128,
                    stdout: '',
                    stderr: 'fatal: cannot list worktrees',
                    overflow: false,
                    messageOverflow: false,
                  })
                : liveGit.run(args, options),
          });
          const { coverage: blind } = yield* coverageOver(roots, mute);
          const refused = yield* Effect.flip(blind.cover(project));
          expect(refused._tag).toBe('ProjectRootsUnavailable');
          if (refused._tag === 'ProjectRootsUnavailable') {
            expect(refused.reason).toBe('registry');
            expect(refused.message).toContain('worktree list');
          }
          const unestablished = yield* Effect.flip(
            blind.admit({ projectId: project, footprint: yield* roots.resolveFootprint(checkout), acquired }),
          );
          expect(unestablished._tag).toBe('ProjectRootsUnavailable');
          if (unestablished._tag === 'ProjectRootsUnavailable') expect(unestablished.reason).toBe('unestablished');
        }),
      ),
    );

    it.effect('a checkout somebody has spoken for is withheld, even once covered, and the rest of the project is still covered', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { roots: own, acquired, rootsOver, coverageOver, files } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'held-');
          const project = yield* projectOf(demo, checkout);
          const worktree = join(yield* tempRootEffect(demo.fixture, 'held-tree-'), 'linked');
          yield* gitEffect(checkout, ['worktree', 'add', '-q', worktree]);
          const spoken = yield* files.realPath(worktree);
          const before = yield* (yield* coverageOver(own, yield* Git)).coverage.cover(project);
          expect(before.roots.map((root) => root.path)).toContain(spoken);
          const roots = yield* rootsOver(own.namespaceId, {
            holding: (_namespace, paths) =>
              Effect.succeed(
                new Map(
                  paths
                    .filter((path) => path === spoken)
                    .map((path) => [path, [{ owner: 'worktree', holder: 'op-held', admits: [{ kind: 'worktree', id: 'op-held' }] }]]),
                ),
              ),
          });
          const { coverage } = yield* coverageOver(roots, yield* Git);
          const covered = yield* coverage.cover(project);
          expect(covered.roots.map((root) => root.origin)).toEqual(['canonical']);
          expect(covered.withheld.map((held) => held.path)).toEqual([spoken]);
          expect(covered.withheld[0]?.reason).toContain('op-held');
          const inside = join(yield* files.realPath(checkout), 'apps');
          const admission = yield* coverage.admit({ projectId: project, footprint: yield* roots.resolveFootprint(inside), acquired });
          expect(admission.covered.map((root) => root.rootId)).toEqual(covered.roots.map((root) => root.rootId));
        }),
      ),
    );

    it.effect('a store that moved refuses the coverage and names the record rather than relocating it', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { coverage, roots, repositories, files } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'moving-');
          const project = yield* projectOf(demo, checkout);
          const covered = yield* coverage.cover(project);
          const first = covered.roots[0];
          if (first === undefined) return yield* Effect.die(new Error('the coverage established no root'));
          const registered = (yield* roots.checked(first.rootId)).git;
          if (registered === null) return yield* Effect.die(new Error('the covered checkout carried no worktree facet'));
          const moved = join(yield* tempRootEffect(demo.fixture, 'objects-'), 'store.git');
          yield* files.rename(join(checkout, '.git'), moved);
          yield* files.writeFileString(join(checkout, '.git'), `gitdir: ${moved}\n`);
          const refused = yield* Effect.flip(coverage.cover(project));
          expect(refused._tag).toBe('RepositoryConflict');
          if (refused._tag === 'RepositoryConflict') {
            expect(refused.reason).toBe('moved');
            expect(refused.repositoryId).toBe(registered.repositoryId);
            expect(refused.registered).toBe(join(checkout, '.git'));
            expect(refused.found).toBe(yield* files.realPath(moved));
          }
          const again = yield* Effect.flip(coverage.cover(project));
          expect(again._tag).toBe('RepositoryConflict');
          if (again._tag === 'RepositoryConflict') {
            expect(again.registered).toBe(join(checkout, '.git'));
            expect(Number(again.locationRevision)).toBe(0);
          }
          const reading = yield* Effect.flip(repositories.read(registered.repositoryId));
          expect(reading._tag).toBe('RepositoryConflict');
          if (reading._tag === 'RepositoryConflict') {
            expect(reading.reason).toBe('replaced');
            expect(reading.commonDirectory).toBe(join(checkout, '.git'));
          }
        }),
      ),
    );

    it.effect('a project whose canonical checkout moved is not admitted against the coverage it left', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { coverage, acquired, projects, roots, files } = yield* composed(demo);
          yield* coverage.cover(demo.projectId);
          const moved = yield* tempRootEffect(demo.fixture, 'moved-');
          yield* files.makeDirectory(moved, { recursive: true });
          yield* demo.graph.projectLifecycle.move(demo.projectId, moved);
          const stale = yield* Effect.flip(
            coverage.admit({ projectId: demo.projectId, footprint: yield* roots.resolveFootprint(moved), acquired }),
          );
          expect(stale._tag).toBe('ProjectRootsUnavailable');
          if (stale._tag === 'ProjectRootsUnavailable') expect(stale.reason).toBe('moved');
          const physical = yield* files.realPath(moved);
          expect((yield* projects.byId(demo.projectId)).rootPath).toBe(physical);
          const taken = yield* coverage.cover(demo.projectId);
          expect(taken.rootPath).toBe(physical);
          expect(taken.roots.map((root) => root.origin)).toEqual(['canonical']);
          const admitted = yield* coverage.admit({ projectId: demo.projectId, footprint: yield* roots.resolveFootprint(moved), acquired });
          expect(admitted.footprint.roots.map(({ root }) => root.rootId)).toEqual(taken.roots.map((root) => root.rootId));
          const aside = yield* tempRootEffect(demo.fixture, 'adopted-');
          yield* files.makeDirectory(aside, { recursive: true });
          const adopted = yield* coverage.adopt(demo.projectId, aside);
          expect(adopted.origin).toBe('adopted');
          expect(new Set((yield* coverage.cover(demo.projectId)).roots.map((root) => root.origin))).toEqual(
            new Set(['canonical', 'adopted']),
          );
        }),
      ),
    );

    it.effect('an unreadable environment or a broken coverage refuses rather than answering outside the project', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { units, uses, roots, coverage, acquired, rootsOver, coverageOver } = yield* composed(demo);
          const established = yield* coverage.cover(demo.projectId);
          const { coverage: elsewhere } = yield* coverageOver(yield* rootsOver(NamespaceId.make('other-namespace')), yield* Git);
          const unavailable = yield* Effect.flip(
            elsewhere.admit({ projectId: demo.projectId, footprint: yield* roots.resolveFootprint(demo.demoRoot), acquired }),
          );
          expect(unavailable._tag).toBe('ProjectRootsUnavailable');
          if (unavailable._tag === 'ProjectRootsUnavailable') expect(unavailable.reason).toBe('environment');
          const first = established.roots[0];
          if (first === undefined) return yield* Effect.die(new Error('the coverage established no roots'));
          const root = yield* roots.checked(first.rootId);
          yield* units.write('ProjectRoots', (unit) =>
            uses.forget(unit, null, { rootId: root.rootId, locationRevision: root.locationRevision }),
          );
          const broken = yield* Effect.flip(
            coverage.admit({ projectId: demo.projectId, footprint: yield* roots.resolveFootprint(demo.demoRoot), acquired }),
          );
          expect(broken._tag).toBe('ProjectRootsUnavailable');
          if (broken._tag === 'ProjectRootsUnavailable') expect(broken.reason).toBe('unestablished');
          const retaken = yield* coverage.cover(demo.projectId);
          expect(retaken.roots.map((root) => root.rootId)).not.toContain(root.rootId);
          expect(
            (yield* coverage.admit({ projectId: demo.projectId, footprint: yield* roots.resolveFootprint(demo.demoRoot), acquired }))
              .covered.length,
          ).toBeGreaterThan(0);
        }),
      ),
    );
  },
);
