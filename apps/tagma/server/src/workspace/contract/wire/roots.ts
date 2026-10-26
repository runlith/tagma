import { Data, Schema } from 'effect';
import { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { LocationRevision, ResourceAddress } from '@runlith/files/resource';
import { RepositoryId } from './repositories.js';
import { RootId } from './ids.js';

export const RootProvenance = Schema.Struct({
  kind: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
});
export type RootProvenance = typeof RootProvenance.Type;

export const RootGit = Schema.Struct({
  repositoryId: RepositoryId,
  gitDirectory: ResourceAddress,
});
export type RootGit = typeof RootGit.Type;

export const FileRoot = Schema.Struct({
  rootId: RootId,
  namespaceId: NamespaceId,
  path: Schema.NonEmptyString,
  locationRevision: LocationRevision,
  witness: IdentityWitness,
  provenance: RootProvenance,
  git: Schema.NullOr(RootGit),
  state: Schema.Literals(['active', 'replaced', 'retired']),
});
export type FileRoot = typeof FileRoot.Type;

export const RootBinding = Schema.Struct({
  rootId: RootId,
  locationRevision: LocationRevision,
});
export type RootBinding = typeof RootBinding.Type;

export const RootRegistration = Schema.Struct({
  path: Schema.NonEmptyString,
  provenance: RootProvenance,
  git: Schema.optional(Schema.NullOr(RootGit)),
});
export type RootRegistration = typeof RootRegistration.Type;

export const RootOverlap = Schema.Struct({
  root: FileRoot,
  resource: ResourceAddress,
  relation: Schema.Literals(['equal', 'ancestor', 'descendant']),
});
export type RootOverlap = typeof RootOverlap.Type;

export const RootFootprint = Schema.Struct({
  status: Schema.Literal('complete'),
  resource: ResourceAddress,
  witness: IdentityWitness,
  registryRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  roots: Schema.Array(RootOverlap),
});
export type RootFootprint = typeof RootFootprint.Type;

export class RootMissing extends Data.TaggedError('RootMissing')<{
  readonly namespaceId: NamespaceId;
  readonly path?: string | undefined;
  readonly rootId?: RootId | undefined;
  readonly message: string;
}> {}

export class RootUnavailable extends Data.TaggedError('RootUnavailable')<{
  readonly namespaceId: NamespaceId;
  readonly path?: string | undefined;
  readonly rootId?: RootId | undefined;
  readonly reason: 'filesystem' | 'storage' | 'identity-unavailable';
  readonly message: string;
}> {}

export class RootInvalid extends Data.TaggedError('RootInvalid')<{
  readonly namespaceId: NamespaceId;
  readonly path: string;
  readonly reason: 'not-directory' | 'relative-path';
  readonly message: string;
}> {}

export class RootConflict extends Data.TaggedError('RootConflict')<{
  readonly namespaceId: NamespaceId;
  readonly path: string;
  readonly rootId?: RootId | undefined;
  readonly locationRevision?: LocationRevision | undefined;
  readonly reason: 'stale-binding' | 'binding-mismatch' | 'resource-changed' | 'registry-changed' | 'reserved' | 'replaced';
  readonly message: string;
}> {}

export const isRegistryChanged = (failure: unknown): failure is RootConflict =>
  failure instanceof RootConflict && failure.reason === 'registry-changed';

export class RootRefused extends Data.TaggedError('RootRefused')<{
  readonly namespaceId: NamespaceId;
  readonly path: string;
  readonly reason: 'foreign-namespace' | 'revision-exhausted';
  readonly message: string;
}> {}

export type RootResolutionFailure = RootMissing | RootUnavailable | RootInvalid | RootConflict | RootRefused;

const ROOT_FAILURES: Record<RootResolutionFailure['_tag'], true> = {
  RootMissing: true,
  RootUnavailable: true,
  RootInvalid: true,
  RootConflict: true,
  RootRefused: true,
};

export const isRootFailure = <F extends { readonly _tag: string }>(failure: F): failure is Extract<F, RootResolutionFailure> =>
  Object.hasOwn(ROOT_FAILURES, failure._tag);
