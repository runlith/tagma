import * as Schema from 'effect/Schema';
import { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { Principal } from '@runlith/executions/protocol/custody';
import { EnvironmentBinding, EnvironmentId } from '../../../workspace/contract/wire/environments.js';
import { RootAdmission } from '../../../workspace/contract/wire/coverage.js';
import { RootBinding, RootFootprint } from '../../../workspace/contract/wire/roots.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';

export const TargetRoot = Schema.Struct({
  rootId: RootId,
  locationRevision: LocationRevision,
  witness: IdentityWitness,
});
export type TargetRoot = typeof TargetRoot.Type;

export const TargetIdentity = Schema.Struct({
  owner: Principal,
  projectId: Schema.Int,
  actor: Principal,
  environmentId: EnvironmentId,
  namespaceId: NamespaceId,
  environmentWitness: IdentityWitness,
  witness: IdentityWitness,
  cwd: Schema.NonEmptyString,
  roots: Schema.Array(TargetRoot),
});
export type TargetIdentity = typeof TargetIdentity.Type;

export const TargetKey = Schema.NonEmptyString.pipe(Schema.brand('TargetKey'));
export type TargetKey = typeof TargetKey.Type;

export const ResolvedExecutionTarget = Schema.Struct({
  projectId: Schema.Int,
  binding: EnvironmentBinding,
  footprint: RootFootprint,
  named: Schema.optional(RootBinding),
});
export type ResolvedExecutionTarget = typeof ResolvedExecutionTarget.Type;

export const AdmittedExecutionTarget = Schema.Struct({
  target: ResolvedExecutionTarget,
  admission: RootAdmission,
});
export type AdmittedExecutionTarget = typeof AdmittedExecutionTarget.Type;

export const targetCwd = (target: ResolvedExecutionTarget): string => target.footprint.resource.path;

export const placeOf = ({ target, admission }: AdmittedExecutionTarget): RootId | undefined => {
  const covered = new Set<string>(admission.covered.map((root) => root.rootId));
  const holding = target.footprint.roots.filter((overlap) => overlap.relation !== 'descendant' && covered.has(overlap.root.rootId));
  const named = target.named === undefined ? undefined : holding.find((overlap) => overlap.root.rootId === target.named?.rootId);
  if (named !== undefined) return named.root.rootId;
  const deepest = holding.reduce<(typeof holding)[number] | undefined>(
    (best, overlap) => (best === undefined || overlap.resource.path.length > best.resource.path.length ? overlap : best),
    undefined,
  );
  return deepest?.root.rootId;
};
