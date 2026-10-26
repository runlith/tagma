import { Data, Schema } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { RootId } from './ids.js';
import { RootFootprint, type RootResolutionFailure } from './roots.js';
import type { RepositoryFailure } from './repositories.js';

export const ProjectRootKind = Schema.Literals(['canonical', 'worktree', 'adopted']);
export type ProjectRootKind = typeof ProjectRootKind.Type;

export const ProjectRoot = Schema.Struct({
  projectId: Schema.Int,
  rootId: RootId,
  path: Schema.NonEmptyString,
  origin: ProjectRootKind,
});
export type ProjectRoot = typeof ProjectRoot.Type;

export const WithheldCheckout = Schema.Struct({
  path: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
});
export type WithheldCheckout = typeof WithheldCheckout.Type;

export const ProjectCoverage = Schema.Struct({
  projectId: Schema.Int,
  namespaceId: NamespaceId,
  rootPath: Schema.NonEmptyString,
  roots: Schema.Array(ProjectRoot),
  withheld: Schema.Array(WithheldCheckout),
});
export type ProjectCoverage = typeof ProjectCoverage.Type;

export const RootAdmission = Schema.Struct({
  coverage: ProjectCoverage,
  covered: Schema.Array(ProjectRoot),
  footprint: RootFootprint,
});
export type RootAdmission = typeof RootAdmission.Type;

export class ProjectRootsUnavailable extends Data.TaggedError('ProjectRootsUnavailable')<{
  readonly projectId: number;
  readonly reason: 'unestablished' | 'moved' | 'registry' | 'environment' | 'foreign-namespace';
  readonly message: string;
}> {}

export type ProjectRootFailure = ProjectRootsUnavailable | RootResolutionFailure | RepositoryFailure;
