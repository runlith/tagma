import { Data, Schema } from 'effect';
import type { Head } from '@runlith/git/repository';
import { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';

export const RepositoryId = Schema.NonEmptyString.pipe(Schema.brand('RepositoryId'));
export type RepositoryId = typeof RepositoryId.Type;

export const Repository = Schema.Struct({
  repositoryId: RepositoryId,
  namespaceId: NamespaceId,
  commonDirectory: Schema.NonEmptyString,
  locationRevision: LocationRevision,
  witness: IdentityWitness,
  projectId: Schema.Int,
  state: Schema.Literals(['active', 'replaced']),
});
export type Repository = typeof Repository.Type;

export const RepositoryBinding = Schema.Struct({
  repositoryId: RepositoryId,
  locationRevision: LocationRevision,
});
export type RepositoryBinding = typeof RepositoryBinding.Type;

export const RepositoryRegistration = Schema.Struct({
  path: Schema.NonEmptyString,
  projectId: Schema.Int,
});
export type RepositoryRegistration = typeof RepositoryRegistration.Type;

export type RepositoryState = {
  readonly repository: Repository;
  readonly bare: boolean;
  readonly head: Head;
};

export type RepositoryBase = {
  readonly repository: Repository;
  readonly commit: string;
};

export const CoveredRepository = Schema.Struct({
  binding: RepositoryBinding,
  commonDirectory: Schema.NonEmptyString,
  bare: Schema.Boolean,
  head: Schema.Struct({ ref: Schema.NullOr(Schema.String), commit: Schema.NullOr(Schema.String) }),
  checkouts: Schema.Array(Schema.NonEmptyString),
});
export type CoveredRepository = typeof CoveredRepository.Type;

export const WithheldStore = Schema.Struct({
  repositoryId: RepositoryId,
  reason: Schema.String,
});
export type WithheldStore = typeof WithheldStore.Type;

export const CoveredRepositoriesAnswer = Schema.Struct({
  repositories: Schema.Array(CoveredRepository),
  withheld: Schema.Array(WithheldStore),
});

export type CoveredRepositoriesAnswer = typeof CoveredRepositoriesAnswer.Type;

export class RepositoryMissing extends Data.TaggedError('RepositoryMissing')<{
  readonly namespaceId: NamespaceId;
  readonly repositoryId?: RepositoryId | undefined;
  readonly path?: string | undefined;
  readonly reason?: 'no-repository' | undefined;
  readonly message: string;
}> {}

export class RepositoryUnavailable extends Data.TaggedError('RepositoryUnavailable')<{
  readonly namespaceId: NamespaceId;
  readonly repositoryId?: RepositoryId | undefined;
  readonly path?: string | undefined;
  readonly reason: 'filesystem' | 'storage' | 'git' | 'identity-unavailable';
  readonly message: string;
}> {}

export class RepositoryConflict extends Data.TaggedError('RepositoryConflict')<{
  readonly repositoryId?: RepositoryId | undefined;
  readonly namespaceId: NamespaceId;
  readonly commonDirectory?: string | undefined;
  readonly locationRevision?: LocationRevision | undefined;
  readonly path?: string | undefined;
  readonly registered?: string | undefined;
  readonly found?: string | undefined;
  readonly expected?: string | undefined;
  readonly reason: 'replaced' | 'moved' | 'resource-changed' | 'registry-changed' | 'stale-binding' | 'binding-mismatch';
  readonly message: string;
}> {}

export class RepositoryBaseMissing extends Data.TaggedError('RepositoryBaseMissing')<{
  readonly repositoryId: RepositoryId;
  readonly namespaceId: NamespaceId;
  readonly commonDirectory: string;
  readonly ref: string | null;
  readonly message: string;
}> {}

export class RepositoryInvalid extends Data.TaggedError('RepositoryInvalid')<{
  readonly namespaceId: NamespaceId;
  readonly path: string;
  readonly reason: 'relative-path' | 'identity-format';
  readonly message: string;
}> {}

export class RepositoryUnreadable extends Data.TaggedError('RepositoryUnreadable')<{
  readonly namespaceId: NamespaceId;
  readonly path: string;
  readonly message: string;
}> {}

export class RepositoryRefused extends Data.TaggedError('RepositoryRefused')<{
  readonly namespaceId: NamespaceId;
  readonly path: string;
  readonly reason: 'discovery-overridden' | 'revision-exhausted';
  readonly message: string;
}> {}

export type RepositoryFailure =
  | RepositoryMissing
  | RepositoryUnavailable
  | RepositoryConflict
  | RepositoryBaseMissing
  | RepositoryInvalid
  | RepositoryUnreadable
  | RepositoryRefused;
