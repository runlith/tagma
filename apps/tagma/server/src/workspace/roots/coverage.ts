import { dirname, isAbsolute, join } from 'node:path';
import { sameWitness } from '@runlith/files/witness';
import { Effect, FileSystem, Result, Semaphore } from 'effect';
import { locationsAt } from '@runlith/git/repository';
import { worktreesOf } from '@runlith/git/worktree';
import { Git } from '@runlith/git/Git';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { assignmentMembership, assignmentSelection, fileRoot, fileRootNamespace, projectRoot, projectRootCover } from '../store/tables.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import {
  ProjectRootsUnavailable,
  type ProjectCoverage,
  type ProjectRoot,
  type ProjectRootFailure,
  type RootAdmission,
  type WithheldCheckout,
} from '../contract/wire/coverage.js';
import type { RootId } from '../contract/wire/ids.js';
import { RootUnavailable, isRegistryChanged, type RootGit, type RootResolutionFailure } from '../contract/wire/roots.js';
import { Coverage, FileRoots, type RootAdmissionRequest, type RootAdoption } from '../contract/service/roots.js';
import { Repositories } from '../contract/service/repositories.js';
import { Projects } from '../../projects/contract/service/registry.js';
import type { CoverageStore } from '../store/coverage.js';
import type { AssignmentStore } from '../store/assignments.js';

type Canonical = { readonly git: RootGit; readonly commonDir: string };

type Placement = { readonly checkout: string; readonly origin: ProjectRoot['origin']; readonly adoption: RootAdoption };

const GITDIR = 'gitdir: ';

const PROBES = 8;

const GIT_LANES = 3;

export const makeCoverageLedger = Effect.fnUntraced(function* ({
  store,
  assignments,
}: {
  readonly store: CoverageStore;
  readonly assignments: AssignmentStore;
}) {
  const projects = yield* Projects;
  const roots = yield* FileRoots;
  const repositories = yield* Repositories;
  const units = yield* MachineUnits;
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;

  const told = new Set<(projectId: number) => void>();

  const covering = Semaphore.makeUnsafe(1);

  const cover = Effect.fn('ProjectRoots.cover')(
    function* (projectId: number): Effect.fn.Return<ProjectCoverage, ProjectRootFailure | StoreFailure> {
      const row = yield* registry(projectId, projects.byId(projectId));
      const standing = yield* registry(
        projectId,
        units.read((unit) => store.stamp(projectId, unit)),
      );
      if (standing !== null && standing.namespaceId !== roots.namespaceId) {
        return yield* new ProjectRootsUnavailable({
          projectId,
          reason: 'foreign-namespace',
          message: `This project's coverage was established in ${standing.namespaceId}; a second namespace does not share this record.`,
        });
      }
      const canonical = yield* facet(row.rootPath, projectId, true);
      const checkouts = canonical === null ? [] : yield* worktrees(row.rootPath, projectId);
      const registered = yield* registry(
        projectId,
        units.read((unit) => Effect.flatMap(store.rootIds(projectId, unit), (rootIds) => roots.live(rootIds, unit))),
      );
      const byPath = new Map(registered.map((root) => [root.path, root]));
      const listed = [row.rootPath, ...checkouts];
      const facts = yield* Effect.forEach(
        listed,
        (checkout) => roots.probe(checkout).pipe(Effect.catchTag('RootMissing', () => Effect.succeed(null))),
        { concurrency: PROBES },
      );
      const visited = new Set<string>();
      const due = listed.flatMap((checkout, at) => {
        const seen = facts[at] ?? null;
        if (seen !== null && visited.has(seen.path)) return [];
        if (seen !== null) visited.add(seen.path);
        return [{ checkout, seen, origin: checkout === row.rootPath ? ('canonical' as const) : ('worktree' as const) }];
      });
      const placed: readonly Placement[] = yield* Effect.forEach(
        due,
        Effect.fnUntraced(function* ({ checkout, seen, origin }) {
          const root = seen === null ? undefined : byPath.get(seen.path);
          const reused = seen !== null && root !== undefined && sameWitness(root.witness, seen.witness) ? root : null;
          const registered = reused?.git ?? null;
          const known =
            registered !== null &&
            canonical !== null &&
            registered.repositoryId === canonical.git.repositoryId &&
            dirname(dirname(registered.gitDirectory.path)) === canonical.commonDir
              ? registered
              : null;
          const git =
            canonical === null
              ? null
              : origin === 'canonical'
                ? canonical.git
                : (known ?? (yield* administered(checkout, projectId, canonical)));
          if (reused !== null) {
            return {
              checkout,
              origin,
              adoption: { root: reused, facet: git ?? undefined, checked: [reused], replaced: [], duplicate: reused, moved: null },
            };
          }
          const adoption = yield* roots.resolve({
            path: checkout,
            provenance: { kind: 'project', id: String(projectId) },
            git: git ?? undefined,
          });
          return { checkout, origin, adoption };
        }),
        { concurrency: GIT_LANES },
      );
      const withheld: WithheldCheckout[] = [];
      const changed = yield* units.write(
        writes('ProjectRoots.moved', [
          projectRoot,
          projectRootCover,
          fileRoot,
          fileRootNamespace,
          assignmentSelection,
          assignmentMembership,
        ]),
        (unit) =>
          Effect.gen(function* () {
            const held = yield* store.stamp(projectId, unit);
            if (held !== null && held.namespaceId !== roots.namespaceId) {
              return yield* new ProjectRootsUnavailable({
                projectId,
                reason: 'foreign-namespace',
                message: `This project's coverage was established in ${held.namespaceId}; a second namespace does not share this record.`,
              });
            }
            const former = yield* store.canonical(projectId, unit);
            const registeredRoots: ProjectRoot[] = [];
            const noted = new Set<RootId>();
            const published = yield* roots.publishAll(
              placed.map((place) => place.adoption),
              unit,
            );
            for (const [at, { checkout, origin }] of placed.entries()) {
              const answer = published[at];
              if (answer === undefined) continue;
              if (Result.isFailure(answer)) {
                withheld.push({ path: checkout, reason: answer.failure.message });
                continue;
              }
              const root = answer.success;
              if (noted.has(root.rootId)) continue;
              noted.add(root.rootId);
              registeredRoots.push({ projectId, rootId: root.rootId, path: root.path, origin });
            }
            const main = registeredRoots.find((root) => root.origin === 'canonical');
            const leaving = former !== null && !noted.has(former) ? former : null;
            const awaited = main === undefined ? leaving : null;
            const stored = yield* store.rootIds(projectId, unit);
            const live = new Set((yield* roots.live(stored, unit)).map((root) => root.rootId));
            yield* store.forget(
              projectId,
              stored.filter((rootId) => !live.has(rootId) && rootId !== awaited),
              unit,
            );
            yield* store.establish(
              {
                projectId,
                namespaceId: roots.namespaceId,
                rootPath: awaited === null || held === null ? row.rootPath : held.rootPath,
                roots: registeredRoots,
                kept: awaited === null ? [] : [awaited],
              },
              unit,
            );
            if (leaving !== null && main !== undefined) yield* assignments.follow(projectId, leaving, main.rootId, unit);
            const before = new Set(stored);
            const now = yield* store.rootIds(projectId, unit);
            return now.length !== stored.length || now.some((rootId) => !before.has(rootId));
          }),
      );
      const coverage = yield* established(projectId, row.rootPath);
      if (changed) announce(projectId);
      return { ...coverage, withheld };
    },
    (work, projectId) =>
      Effect.mapError(covering.withPermit(Effect.retry(work, { while: isRegistryChanged })), (error) => refusalOf(error, projectId)),
  );

  const adopt = Effect.fn('ProjectRoots.adopt')(
    function* (
      projectId: number,
      path: string,
    ): Effect.fn.Return<ProjectRoot, ProjectRootsUnavailable | RootResolutionFailure | StoreFailure> {
      yield* registry(projectId, projects.byId(projectId));
      const root = yield* roots.register({ path, provenance: { kind: 'project', id: String(projectId) } });
      yield* units.write(writes('ProjectRoots.adopt', [projectRoot]), (unit) => store.adopt(projectId, root.rootId, unit));
      announce(projectId);
      return { projectId, rootId: root.rootId, path: root.path, origin: 'adopted' };
    },
    (work, projectId) => Effect.mapError(work, (error) => refusalOf(error, projectId)),
  );

  const covered = Effect.fn('ProjectRoots.covered')(
    function* (projectId: number): Effect.fn.Return<ProjectCoverage, ProjectRootsUnavailable | StoreFailure> {
      const row = yield* registry(projectId, projects.byId(projectId));
      return yield* established(projectId, row.rootPath);
    },
    (work, projectId) => Effect.mapError(work, (error) => refusalOf(error, projectId)),
  );

  const survey = Effect.fn('ProjectRoots.survey')(
    function* (projectId: number): Effect.fn.Return<ProjectCoverage, ProjectRootFailure | StoreFailure> {
      const row = yield* registry(projectId, projects.byId(projectId));
      const surveyed = yield* Effect.result(established(projectId, row.rootPath));
      if (surveyed._tag === 'Failure') {
        const refusal = surveyed.failure;
        if (refusal.reason !== 'unestablished' && refusal.reason !== 'moved') return yield* refusal;
        return yield* cover(projectId);
      }
      const coverage = surveyed.success;
      const canonical = coverage.roots.find((root) => root.origin === 'canonical');
      if (canonical !== undefined && (yield* roots.checked(canonical.rootId)).git === null) return coverage;
      const named = new Set(coverage.roots.map((root) => root.path));
      for (const checkout of yield* worktrees(row.rootPath, projectId)) {
        const seen = yield* roots.probe(checkout).pipe(Effect.catchTag('RootMissing', () => Effect.succeed(null)));
        if (seen === null || named.has(seen.path)) continue;
        return yield* cover(projectId);
      }
      return coverage;
    },
    (work, projectId) => Effect.mapError(work, (error) => refusalOf(error, projectId)),
  );

  const admit = Effect.fn('ProjectRoots.admit')(
    function* (
      request: RootAdmissionRequest,
    ): Effect.fn.Return<RootAdmission, ProjectRootsUnavailable | RootResolutionFailure | StoreFailure> {
      const { projectId, acquired } = request;
      const binding = acquired.binding;
      if (binding.namespaceId !== roots.namespaceId) {
        return yield* new ProjectRootsUnavailable({
          projectId,
          reason: 'environment',
          message: `The acquired ${binding.kind} environment resolves paths in ${binding.namespaceId}; these roots are registered in ${roots.namespaceId}, so this installation has no registry for that environment.`,
        });
      }
      const row = yield* registry(projectId, projects.byId(projectId));
      const coverage = yield* established(projectId, row.rootPath);
      const footprint = yield* roots.recheck(request.footprint);
      const covered = coverage.roots.filter((root) => footprint.roots.some((overlap) => overlap.root.rootId === root.rootId));
      return { coverage, covered, footprint };
    },
    (work, request) => Effect.mapError(work, (error) => refusalOf(error, request.projectId)),
  );

  const followAcross = Effect.fn('ProjectRoots.followAcross')(function* (path: string) {
    for (let at = path; ; at = dirname(at)) {
      const matched = yield* roots.matching(at).pipe(Effect.catchTag('RootMissing', () => Effect.succeed(null)));
      if (matched !== null && matched.path !== matched.root.path) {
        const memberships = yield* units
          .read((unit) => store.projectsOf(matched.root.rootId, unit))
          .pipe(
            Effect.mapError(
              (failure) =>
                new RootUnavailable({
                  namespaceId: roots.namespaceId,
                  path: matched.path,
                  rootId: matched.root.rootId,
                  reason: 'storage',
                  message: failure.message,
                }),
            ),
          );
        const projectId = memberships[0];
        if (projectId !== undefined) {
          const relocatedGit =
            matched.root.git === null
              ? undefined
              : {
                  ...matched.root.git,
                  gitDirectory: { namespaceId: roots.namespaceId, path: (yield* locate(matched.path, projectId)).gitDir },
                };
          yield* roots.relocate(matched, relocatedGit);
          for (const projectId of memberships) announce(projectId);
          return true;
        }
      }
      if (at === dirname(at)) return false;
    }
  });

  const follow = Effect.fn('ProjectRoots.follow')(
    function* (projectId: number, path: string): Effect.fn.Return<boolean, ProjectRootsUnavailable | RootResolutionFailure | StoreFailure> {
      const coverage = yield* covered(projectId);
      const gone: RootId[] = [];
      for (const root of coverage.roots) {
        const seen = yield* roots.probe(root.path).pipe(Effect.catchTag('RootMissing', () => Effect.succeed(null)));
        if (seen === null) gone.push(root.rootId);
      }
      if (gone.length === 0) return false;
      const records = yield* roots.live(gone);
      for (let at = path; at !== dirname(at); at = dirname(at)) {
        const fact = yield* roots.probe(at).pipe(Effect.catchTag('RootMissing', () => Effect.succeed(null)));
        if (fact === null) continue;
        const root = records.find((one) => sameWitness(one.witness, fact.witness));
        if (root === undefined) continue;
        yield* roots.register({ path: fact.path, provenance: root.provenance });
        announce(projectId);
        return true;
      }
      return false;
    },
    (work, projectId) => Effect.mapError(work, (error) => refusalOf(error, projectId)),
  );

  const onCovered = (listener: (projectId: number) => void): (() => void) => {
    told.add(listener);
    return () => {
      told.delete(listener);
    };
  };

  const recorded = (projectId: number): void => announce(projectId);

  function announce(projectId: number): void {
    for (const listener of told) listener(projectId);
  }

  const established = Effect.fn('ProjectRoots.established')(function* (
    projectId: number,
    rootPath: string,
  ): Effect.fn.Return<ProjectCoverage, ProjectRootsUnavailable> {
    const record = yield* registry(
      projectId,
      units.read((unit) =>
        Effect.gen(function* () {
          const rootIds = yield* store.rootIds(projectId, unit);
          const paths = new Map<RootId, string>();
          for (const root of yield* roots.live(rootIds, unit)) paths.set(root.rootId, root.path);
          return yield* store.coverage(projectId, paths, unit);
        }),
      ),
    );
    if (record === null) {
      return yield* new ProjectRootsUnavailable({
        projectId,
        reason: 'unestablished',
        message: 'This project has no established root coverage; nothing here says it has no managed roots.',
      });
    }
    const { coverage } = record;
    if (coverage.namespaceId !== roots.namespaceId) {
      return yield* new ProjectRootsUnavailable({
        projectId,
        reason: 'foreign-namespace',
        message: `This project's coverage was established in ${coverage.namespaceId}; these roots are registered in ${roots.namespaceId}.`,
      });
    }
    if (coverage.rootPath !== rootPath) {
      return yield* new ProjectRootsUnavailable({
        projectId,
        reason: 'moved',
        message: `The coverage was established against ${coverage.rootPath}; the project's canonical checkout is now ${rootPath}.`,
      });
    }
    if (coverage.roots.length !== record.associated) {
      return yield* new ProjectRootsUnavailable({
        projectId,
        reason: 'unestablished',
        message: 'A registration this coverage names can no longer be read; the coverage must be taken again.',
      });
    }
    return coverage;
  });

  const facet = Effect.fn('ProjectRoots.facet')(function* (
    checkout: string,
    projectId: number,
    mayBePlain: boolean,
  ): Effect.fn.Return<Canonical | null, ProjectRootFailure> {
    const repository = yield* repositories
      .register({ path: checkout, projectId })
      .pipe(
        Effect.catchTag('RepositoryMissing', (refusal) =>
          mayBePlain && refusal.reason === 'no-repository' ? Effect.succeed(null) : Effect.fail(refusal),
        ),
      );
    if (repository === null) return null;
    const locations = yield* locate(checkout, projectId);
    if (locations.prefix !== '') return null;
    return {
      git: { repositoryId: repository.repositoryId, gitDirectory: { namespaceId: roots.namespaceId, path: locations.gitDir } },
      commonDir: locations.commonDir,
    };
  });

  const administration = Effect.fn('ProjectRoots.administration')(function* (checkout: string, commonDir: string) {
    const marker = join(checkout, '.git');
    const info = yield* files.stat(marker);
    if (info.type === 'Directory') {
      const at = yield* files.realPath(marker);
      return at === commonDir ? at : null;
    }
    if (info.type !== 'File') return null;
    const first = (yield* files.readFileString(marker)).split('\n', 1)[0] ?? '';
    const named = first.startsWith(GITDIR) ? first.slice(GITDIR.length).trim() : '';
    if (named === '') return null;
    const at = yield* files.realPath(isAbsolute(named) ? named : join(checkout, named));
    const common = ((yield* files.readFileString(join(at, 'commondir'))).split('\n', 1)[0] ?? '').trim();
    if (common === '') return null;
    return (yield* files.realPath(isAbsolute(common) ? common : join(at, common))) === commonDir ? at : null;
  });

  const administered = Effect.fn('ProjectRoots.administered')(function* (
    checkout: string,
    projectId: number,
    canonical: Canonical,
  ): Effect.fn.Return<RootGit | null, ProjectRootFailure> {
    const asked = Effect.map(facet(checkout, projectId, false), (placed) => placed?.git ?? null);
    return yield* administration(checkout, canonical.commonDir).pipe(
      Effect.flatMap((gitDir) =>
        gitDir === null
          ? asked
          : Effect.succeed({ repositoryId: canonical.git.repositoryId, gitDirectory: { namespaceId: roots.namespaceId, path: gitDir } }),
      ),
      Effect.catchTag('PlatformError', () => asked),
    );
  });

  const worktrees = Effect.fn('ProjectRoots.worktrees')(function* (
    rootPath: string,
    projectId: number,
  ): Effect.fn.Return<readonly string[], ProjectRootsUnavailable> {
    const listed = yield* worktreesOf(git, rootPath).pipe(
      Effect.mapError(
        (error) =>
          new ProjectRootsUnavailable({
            projectId,
            reason: 'registry',
            message: `Git could not list the checkouts of ${rootPath}, so what this project covers is unknown: ${error.command.join(' ')}`,
          }),
      ),
    );
    return listed.filter((worktree) => worktree.prunable === null).map((worktree) => worktree.path);
  });

  const locate = Effect.fn('ProjectRoots.locations')((checkout: string, projectId: number) =>
    locationsAt(git, checkout).pipe(
      Effect.mapError(
        (error) =>
          new ProjectRootsUnavailable({
            projectId,
            reason: 'registry',
            message: `Git could not place the checkout ${checkout}: ${error.command.join(' ')}`,
          }),
      ),
    ),
  );

  const registry = Effect.fn('ProjectRoots.registry')(<A, E>(projectId: number, read: Effect.Effect<A, E>) =>
    Effect.mapError(
      read,
      (error) =>
        new ProjectRootsUnavailable({
          projectId,
          reason: 'registry',
          message: `The project registry cannot answer for ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
        }),
    ),
  );

  function refusalOf<E extends ProjectRootFailure | StoreFailure>(
    error: E,
    projectId: number,
  ): Exclude<E, StoreFailure> | ProjectRootsUnavailable;

  function refusalOf(error: ProjectRootFailure | StoreFailure, projectId: number): ProjectRootFailure {
    switch (error._tag) {
      case 'ProjectRootsUnavailable':
      case 'RootMissing':
      case 'RootUnavailable':
      case 'RootInvalid':
      case 'RootConflict':
      case 'RootRefused':
      case 'RepositoryMissing':
      case 'RepositoryUnavailable':
      case 'RepositoryConflict':
      case 'RepositoryBaseMissing':
      case 'RepositoryInvalid':
      case 'RepositoryUnreadable':
      case 'RepositoryRefused':
        return error;
      default:
        return new ProjectRootsUnavailable({
          projectId,
          reason: 'registry',
          message: `The machine store could not answer: ${error.message}`,
        });
    }
  }

  return Coverage.of({ cover, adopt, covered, survey, admit, followAcross, follow, onCovered, recorded });
});
