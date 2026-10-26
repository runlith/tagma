import { Context, type Effect } from 'effect';
import type { LocationRevision } from '@runlith/files/resource';
import type {
  Repository,
  RepositoryBase,
  RepositoryBinding,
  RepositoryFailure,
  RepositoryId,
  RepositoryRegistration,
  RepositoryState,
  CoveredRepositoriesAnswer,
} from '../wire/repositories.js';
import type { ProjectRootFailure } from '../wire/coverage.js';
import type { CommitLocations } from '../wire/history.js';
import type { RootResolutionFailure } from '../wire/roots.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export type CoveredRepositoriesFailure = ProjectRootFailure | RootResolutionFailure;

export class CoveredRepositories extends Context.Service<
  CoveredRepositories,
  {
    list(projectId: number): Effect.Effect<CoveredRepositoriesAnswer, CoveredRepositoriesFailure>;
    at(projectId: number, path: string): Effect.Effect<CoveredRepositoriesAnswer, CoveredRepositoriesFailure>;
    covers(projectId: number, repositoryId: RepositoryId): Effect.Effect<boolean, CoveredRepositoriesFailure>;
    commits(ids: readonly string[], preferred: number): Effect.Effect<CommitLocations, StoreFailure>;
  }
>()('tagma/workspace/CoveredRepositories') {}

export class Repositories extends Context.Service<
  Repositories,
  {
    register(input: RepositoryRegistration): Effect.Effect<Repository, RepositoryFailure>;
    read(repositoryId: RepositoryId, locationRevision?: LocationRevision): Effect.Effect<RepositoryState, RepositoryFailure>;
    at(path: string): Effect.Effect<string, RepositoryFailure>;
    base(repositoryId: RepositoryId, locationRevision?: LocationRevision): Effect.Effect<RepositoryBase, RepositoryFailure>;
    relocate(binding: RepositoryBinding, path: string): Effect.Effect<Repository, RepositoryFailure>;
  }
>()('tagma/workspace/Repositories') {}
