import { Schema } from 'effect';
import { ApprovalModeView } from '@runlith/agent/modes/ApprovalMode';
import type { ThreadSpawnDepth } from '@runlith/agent/collaboration/ThreadSpawnAccess';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { RootBinding } from '../../../workspace/contract/wire/roots.js';
import { harnessInstallSchema } from './harness/externalSession.js';

export const threadTypeSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  baseAgentId: Schema.String,
  harness: Schema.optional(harnessInstallSchema),
});
export type ThreadTypeRow = typeof threadTypeSchema.Type;

export const threadTypesSchema = Schema.Struct({
  types: Schema.Array(threadTypeSchema),
  rejected: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  default: Schema.String,
  modes: Schema.Array(ApprovalModeView),
});
export type ThreadTypesPage = typeof threadTypesSchema.Type;

export const delegationSchema = Schema.Struct({
  own: Schema.NullOr(Schema.Boolean),
  allowed: Schema.Boolean,
  setAt: Schema.NullOr(Schema.String),
});
export type Delegation = typeof delegationSchema.Type;

export const spawnDepthSchema = Schema.Struct({
  current: Schema.Int,
  maximum: Schema.Int,
  remaining: Schema.Int,
}) satisfies Schema.Schema<ThreadSpawnDepth>;

export const threadPlaceSchema = Schema.Struct({
  rootId: Schema.NonEmptyString,
  branch: Schema.NullOr(Schema.NonEmptyString),
});
export type ThreadPlace = typeof threadPlaceSchema.Type;

export const BirthPlace = Schema.Union([
  Schema.Struct({ ...RootBinding.fields, projectId: Schema.optional(Schema.Int) }),
  Schema.Struct({ projectId: Schema.Int }),
]);
export type BirthPlace = typeof BirthPlace.Type;

export const birthRoot = (place: BirthPlace | undefined): RootBinding | undefined =>
  place === undefined || !('rootId' in place) ? undefined : { rootId: place.rootId, locationRevision: place.locationRevision };

export type ModelPreference = {
  readonly account: string | null;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
};
