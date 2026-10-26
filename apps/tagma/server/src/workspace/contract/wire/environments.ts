import { Schema } from 'effect';
import { IdentityWitness, NamespaceId } from '@runlith/files/namespace';

export const EnvironmentId = Schema.NonEmptyString.pipe(Schema.brand('EnvironmentId'));
export type EnvironmentId = typeof EnvironmentId.Type;

export const EnvironmentKind = Schema.Literals(['host', 'sandbox']);
export type EnvironmentKind = typeof EnvironmentKind.Type;

export const EnvironmentIdentity = Schema.Struct({
  environmentId: EnvironmentId,
  kind: EnvironmentKind,
  namespaceId: NamespaceId,
});
export type EnvironmentIdentity = typeof EnvironmentIdentity.Type;

export const EnvironmentBinding = Schema.Struct({
  ...EnvironmentIdentity.fields,
  identityWitness: IdentityWitness,
});
export type EnvironmentBinding = typeof EnvironmentBinding.Type;

export const EnvironmentAvailability = Schema.Literals(['available', 'unavailable', 'replaced', 'unknown']);
export type EnvironmentAvailability = typeof EnvironmentAvailability.Type;

export const EnvironmentCapability = Schema.Literals(['files', 'exec', 'heldExecution', 'egress']);
export type EnvironmentCapability = typeof EnvironmentCapability.Type;

export const EnvironmentCapabilities = Schema.Struct({
  files: Schema.Boolean,
  exec: Schema.Boolean,
  heldExecution: Schema.Boolean,
  egress: Schema.Boolean,
});
export type EnvironmentCapabilities = typeof EnvironmentCapabilities.Type;

export const EnvironmentState = Schema.Struct({
  identity: EnvironmentIdentity,
  binding: Schema.NullOr(EnvironmentBinding),
  availability: EnvironmentAvailability,
  capabilities: EnvironmentCapabilities,
  reason: Schema.NullOr(Schema.String),
});
export type EnvironmentState = typeof EnvironmentState.Type;

export const EnvironmentUseId = Schema.NonEmptyString.pipe(Schema.brand('EnvironmentUseId'));
export type EnvironmentUseId = typeof EnvironmentUseId.Type;

export const EnvironmentConsumer = Schema.Struct({
  kind: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
});
export type EnvironmentConsumer = typeof EnvironmentConsumer.Type;

export const EnvironmentUseStatus = Schema.Literals(['reserved', 'active', 'release-pending', 'released']);
export type EnvironmentUseStatus = typeof EnvironmentUseStatus.Type;

export const EnvironmentUse = Schema.Struct({
  useId: EnvironmentUseId,
  consumer: EnvironmentConsumer,
  binding: EnvironmentBinding,
  outcome: EnvironmentUseStatus,
});
export type EnvironmentUse = typeof EnvironmentUse.Type;

export const EnvironmentUseEvidence = Schema.Literals(['cleanup-confirmed', 'never-applied', 'uncertain', 'abandoned']);
export type EnvironmentUseEvidence = typeof EnvironmentUseEvidence.Type;

export const EnvironmentInput = Schema.Struct({
  binding: EnvironmentBinding,
  consumer: EnvironmentConsumer,
  requires: Schema.Array(EnvironmentCapability),
});
export type EnvironmentInput = typeof EnvironmentInput.Type;

export const EnvironmentUseReceipt = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Retained'), use: EnvironmentUse }),
  Schema.Struct({ _tag: Schema.Literal('Intrinsic'), binding: EnvironmentBinding }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type EnvironmentUseReceipt = typeof EnvironmentUseReceipt.Type;

export const EnvironmentVerdictFailure = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('EnvironmentUnavailable'),
    binding: EnvironmentBinding,
    witnessed: Schema.Boolean,
    reason: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal('EnvironmentReplaced'), binding: EnvironmentBinding, current: IdentityWitness }),
  Schema.Struct({ _tag: Schema.Literal('EnvironmentAccessDenied'), binding: EnvironmentBinding, reason: Schema.String }),
  Schema.Struct({
    _tag: Schema.Literal('EnvironmentUseConflict'),
    binding: EnvironmentBinding,
    held: Schema.Array(EnvironmentConsumer),
    holders: Schema.Int.check(Schema.isGreaterThan(0)),
    standing: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({
    _tag: Schema.Literal('ActivationUnsupported'),
    kind: EnvironmentKind,
    binding: Schema.NullOr(EnvironmentBinding),
    capability: Schema.Literals([...EnvironmentCapability.literals, 'activation', 'access']),
    reason: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal('EnvironmentRegistryUnavailable'), reason: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('EnvironmentUseMissing'), useId: EnvironmentUseId }),
  Schema.Struct({
    _tag: Schema.Literal('EnvironmentUseResolved'),
    useId: EnvironmentUseId,
    outcome: EnvironmentUseStatus,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type EnvironmentVerdictFailure = typeof EnvironmentVerdictFailure.Type;
