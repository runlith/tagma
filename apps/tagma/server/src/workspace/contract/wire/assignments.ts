import { Data, Schema } from 'effect';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { RootId } from './ids.js';
import { RootBinding, type RootResolutionFailure } from './roots.js';

export const AssignmentProvenance = Schema.Literals(['intrinsic', 'inherited', 'explicit', 'cleared']);
export type AssignmentProvenance = typeof AssignmentProvenance.Type;

export const SelectionProvenance = Schema.Literals(['inherited', 'explicit', 'cleared']);
export type SelectionProvenance = typeof SelectionProvenance.Type;

export const MembershipProvenance = Schema.Literals(['inherited', 'explicit']);
export type MembershipProvenance = typeof MembershipProvenance.Type;

export const Membership = Schema.Struct({
  threadId: ThreadId,
  rootId: RootId,
  provenance: MembershipProvenance,
});
export type Membership = typeof Membership.Type;

export const SelectionRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('SelectionRevision'));
export type SelectionRevision = typeof SelectionRevision.Type;

export const RootSelection = Schema.Struct({
  rootId: Schema.NullOr(RootId),
  provenance: AssignmentProvenance,
  revision: SelectionRevision,
});
export type RootSelection = typeof RootSelection.Type;

export const RootState = Schema.Literals(['live', 'gone', 'none']);
export type RootState = typeof RootState.Type;

export const Assignment = Schema.Struct({
  threadId: ThreadId,
  memberships: Schema.Array(Membership),
  selection: RootSelection,
  standing: RootState,
});
export type Assignment = typeof Assignment.Type;

export const AssignmentActor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('operator') }),
  Schema.Struct({ kind: Schema.Literal('thread'), threadId: ThreadId }),
]);
export type AssignmentActor = typeof AssignmentActor.Type;

export const AssignmentTarget = Schema.Struct({
  actor: AssignmentActor,
  threadId: ThreadId,
});
export type AssignmentTarget = typeof AssignmentTarget.Type;

export const AssignmentInput = Schema.Struct({
  ...AssignmentTarget.fields,
  root: RootBinding,
});
export type AssignmentInput = typeof AssignmentInput.Type;

export const MembershipRelease = Schema.Struct({
  ...AssignmentTarget.fields,
  rootId: RootId,
});
export type MembershipRelease = typeof MembershipRelease.Type;

export const AssignmentBirth = Schema.Struct({
  threadId: ThreadId,
  parentThreadId: ThreadId,
  root: Schema.optional(RootBinding),
  lineage: Schema.optional(Schema.Literals(['child', 'branch'])),
});
export type AssignmentBirth = typeof AssignmentBirth.Type;

export const Publication = Schema.Struct({
  threadId: ThreadId,
  selection: RootSelection,
  standing: RootState,
  current: Schema.Boolean,
});
export type Publication = typeof Publication.Type;

export class AssignmentRefused extends Data.TaggedError('AssignmentRefused')<{
  readonly threadId: ThreadId;
  readonly rootId?: RootId | undefined;
  readonly reason: 'unknown-thread' | 'out-of-reach' | 'not-a-member' | 'selected' | 'revision-exhausted';
  readonly message: string;
}> {}

export class AssignmentUnavailable extends Data.TaggedError('AssignmentUnavailable')<{
  readonly threadId?: ThreadId | undefined;
  readonly rootId?: RootId | undefined;
  readonly message: string;
}> {}

export type AssignmentFailure = AssignmentRefused | AssignmentUnavailable | RootResolutionFailure;
