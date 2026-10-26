import { Effect, FileSystem, Path } from 'effect';
import { commitIdsAt } from '@runlith/git/history';
import { Git } from '@runlith/git/Git';
import { troubleOf } from '@runlith/git/repository';
import { actingGit } from '../../platform/git/ownGit.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Coverage, FileRoots } from '../contract/service/roots.js';
import type { ProjectCoverage } from '../contract/wire/coverage.js';
import type { LocatedCommit, UnreadProject } from '../contract/wire/history.js';
import {
  RepositoryInvalid,
  RepositoryUnavailable,
  type CoveredRepository,
  type RepositoryId,
  type CoveredRepositoriesAnswer,
  type WithheldStore,
} from '../contract/wire/repositories.js';
import { CoveredRepositories, Repositories, type CoveredRepositoriesFailure } from '../contract/service/repositories.js';

const COMMIT_RECORD = 16_384;

type Covered = {
  readonly repositoryId: RepositoryId;
  readonly checkouts: readonly string[];
};

export const makeCoveredRepositoryReader = Effect.gen(function* () {
  const coverage = yield* Coverage;
  const roots = yield* FileRoots;
  const registry = yield* Repositories;
  const paths = yield* Path.Path;
  const files = yield* FileSystem.FileSystem;
  const projects = yield* Projects;
  const git = actingGit(yield* Git, 'commit-locate');

  const list = Effect.fn('ProjectStores.list')(function* (
    projectId: number,
  ): Effect.fn.Return<CoveredRepositoriesAnswer, CoveredRepositoriesFailure> {
    const covered = yield* stores(projectId);
    const reads = yield* Effect.forEach(covered, (store) => Effect.map(Effect.result(standing(store)), (read) => ({ store, read })), {
      concurrency: 4,
    });
    const repositories: CoveredRepository[] = [];
    const withheld: WithheldStore[] = [];
    for (const { store, read } of reads) {
      if (read._tag === 'Success') repositories.push(read.success);
      else withheld.push({ repositoryId: store.repositoryId, reason: read.failure.message });
    }
    return { repositories, withheld };
  });

  const at = Effect.fn('ProjectStores.at')(function* (
    projectId: number,
    path: string,
  ): Effect.fn.Return<CoveredRepositoriesAnswer, CoveredRepositoriesFailure> {
    if (!paths.isAbsolute(path)) {
      return yield* new RepositoryInvalid({
        namespaceId: roots.namespaceId,
        path,
        reason: 'relative-path',
        message: 'A place is named by an absolute path in the namespace these roots are registered in.',
      });
    }
    const covered = yield* stores(projectId);
    if (covered.length === 0) return { repositories: [], withheld: [] };
    const here = yield* canonical(path);
    if (here === null) return { repositories: [], withheld: [] };
    const candidates: Covered[] = [];
    const withheld: WithheldStore[] = [];
    for (const store of covered) {
      let contains = false;
      let unreadable: string | null = null;
      for (const checkout of store.checkouts) {
        const stands = yield* canonical(checkout);
        if (stands === null) {
          unreadable = `${checkout} resolves to nothing that stands, so whether it covers ${path} is unknown`;
          continue;
        }
        if (withinCheckout(stands, here)) {
          contains = true;
          break;
        }
      }
      if (contains) candidates.push(store);
      else if (unreadable !== null) withheld.push({ repositoryId: store.repositoryId, reason: unreadable });
    }
    if (candidates.length === 0) return { repositories: [], withheld };
    const belongs = yield* registry.at(here);
    const repositories: CoveredRepository[] = [];
    for (const candidate of candidates) {
      const read = yield* Effect.result(standing(candidate));
      if (read._tag === 'Failure') {
        withheld.push({ repositoryId: candidate.repositoryId, reason: read.failure.message });
        continue;
      }
      if (belongs === read.success.commonDirectory) repositories.push(read.success);
    }
    return { repositories, withheld };
  });

  const canonical = Effect.fn('ProjectStores.canonical')(function* (
    path: string,
  ): Effect.fn.Return<string | null, CoveredRepositoriesFailure> {
    let place = path;
    for (;;) {
      const read = yield* files
        .realPath(place)
        .pipe(
          Effect.catchTag('PlatformError', (failure) =>
            failure.reason._tag === 'NotFound'
              ? Effect.succeed(null)
              : new RepositoryUnavailable({ namespaceId: roots.namespaceId, path, reason: 'filesystem', message: failure.message }),
          ),
        );
      if (read !== null) return read;
      const parent = paths.dirname(place);
      if (parent === place) return null;
      place = parent;
    }
  });

  const covers = Effect.fn('ProjectStores.covers')(function* (
    projectId: number,
    repositoryId: RepositoryId,
  ): Effect.fn.Return<boolean, CoveredRepositoriesFailure> {
    return (yield* stores(projectId)).some((store) => store.repositoryId === repositoryId);
  });

  const commits = Effect.fn('ProjectStores.commits')(function* (ids: readonly string[], preferred: number) {
    const asked = [...new Set(ids)];
    const listed = (yield* projects.list()).map((project) => project.id);
    const others = listed.filter((projectId) => projectId !== preferred).sort((a, b) => a - b);
    const asking = new Set<RepositoryId>();
    const located = new Map<string, LocatedCommit>();
    const ambiguous = new Set<string>();
    const unread: UnreadProject[] = [];
    for (const level of [listed.includes(preferred) ? [preferred] : [], others]) {
      const missing = asked.filter((id) => !located.has(id) && !ambiguous.has(id));
      if (missing.length === 0 || level.length === 0) continue;
      const covered = yield* Effect.forEach(
        level,
        (projectId) => Effect.map(Effect.result(storesOf(established(projectId))), (read) => ({ projectId, read })),
        {
          concurrency: 4,
        },
      );
      const repositories: { readonly projectId: number; readonly checkout: string }[] = [];
      for (const { projectId, read } of covered) {
        if (read._tag === 'Failure') {
          unread.push({ projectId, reason: read.failure.message });
          continue;
        }
        for (const store of read.success) {
          const checkout = store.checkouts[0];
          if (checkout === undefined || asking.has(store.repositoryId)) continue;
          asking.add(store.repositoryId);
          repositories.push({ projectId, checkout });
        }
      }
      const answers = yield* Effect.forEach(
        repositories,
        (repository) =>
          Effect.map(
            Effect.result(commitIdsAt(git, repository.checkout, missing, { capture: (missing.length + 1) * COMMIT_RECORD })),
            (read) => ({
              repository,
              read,
            }),
          ),
        { concurrency: 4 },
      );
      const found = new Map<string, LocatedCommit[]>();
      for (const { repository, read } of answers) {
        if (read._tag === 'Failure') {
          unread.push({ projectId: repository.projectId, reason: troubleOf(read.failure) });
          continue;
        }
        for (const id of read.success.ambiguous) ambiguous.add(id);
        for (const [id, commit] of read.success.commits) {
          found.set(id, [...(found.get(id) ?? []), { id, sha: commit.sha, subject: commit.subject, projectId: repository.projectId }]);
        }
      }
      for (const [id, [first, ...rest]] of found) {
        if (first === undefined || ambiguous.has(id)) continue;
        if (rest.every((row) => row.sha === first.sha)) located.set(id, first);
        else ambiguous.add(id);
      }
    }
    return { commits: asked.flatMap((id) => located.get(id) ?? []), unread };
  });

  const established = (projectId: number): Effect.Effect<ProjectCoverage, CoveredRepositoriesFailure> =>
    coverage
      .covered(projectId)
      .pipe(
        Effect.catchTag('ProjectRootsUnavailable', (refusal) =>
          refusal.reason === 'unestablished' || refusal.reason === 'moved' ? coverage.cover(projectId) : Effect.fail(refusal),
        ),
      );

  const stores = (projectId: number): Effect.Effect<readonly Covered[], CoveredRepositoriesFailure> =>
    storesOf(coverage.covered(projectId));

  const storesOf = Effect.fn('ProjectStores.stores')(function* (
    covering: Effect.Effect<ProjectCoverage, CoveredRepositoriesFailure>,
  ): Effect.fn.Return<readonly Covered[], CoveredRepositoriesFailure> {
    const projectCoverage = yield* covering;
    const live = yield* roots.live(projectCoverage.roots.map((root) => root.rootId));
    const byStore = new Map<RepositoryId, string[]>();
    for (const root of live) {
      if (root.git === null) continue;
      const checkouts = byStore.get(root.git.repositoryId);
      if (checkouts === undefined) byStore.set(root.git.repositoryId, [root.path]);
      else checkouts.push(root.path);
    }
    return [...byStore].map(([repositoryId, checkouts]) => ({ repositoryId, checkouts }));
  });

  const standing = Effect.fn('ProjectStores.standing')(function* (
    store: Covered,
  ): Effect.fn.Return<CoveredRepository, CoveredRepositoriesFailure> {
    const read = yield* registry.read(store.repositoryId);
    return {
      binding: {
        repositoryId: read.repository.repositoryId,
        locationRevision: read.repository.locationRevision,
      },
      commonDirectory: read.repository.commonDirectory,
      bare: read.bare,
      head: { ref: read.head.ref, commit: read.head.commit },
      checkouts: [...store.checkouts].sort(),
    };
  });

  return CoveredRepositories.of({ list, at, covers, commits });
});

export const withinCheckout = (checkout: string, path: string): boolean =>
  path === checkout || path.startsWith(checkout.endsWith('/') ? checkout : `${checkout}/`);
