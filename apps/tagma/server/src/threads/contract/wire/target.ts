import * as Schema from 'effect/Schema';
import { LocationRevision } from '@runlith/files/resource';
import { SelectionRevision } from '../../../workspace/contract/wire/assignments.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { RootBinding } from '../../../workspace/contract/wire/roots.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import { ProvedRoot, WorkOrigin, type WorkingOrigin, type WorkingRoot, type TargetAt } from '../../../workspace/contract/wire/place.js';

export const GraphOrigin = Schema.Struct({
  projectId: Schema.Int,
  root: Schema.NonEmptyString,
});
export type GraphOrigin = typeof GraphOrigin.Type;

export const TargetSnapshot = Schema.Struct({
  work: WorkOrigin,
  runId: Schema.NonEmptyString,
  generation: WorkspaceGeneration,
  sourceKey: Schema.NonEmptyString,
  workingRoot: Schema.NonEmptyString,
  place: Schema.NullOr(ProvedRoot),
  graph: GraphOrigin,
  admittedAt: Schema.String,
});
export type TargetSnapshot = typeof TargetSnapshot.Type;

export const rootOf = (target: TargetSnapshot): WorkingRoot | null =>
  target.place === null ? null : { ...target.place, generation: target.generation };

export const originOf = (target: TargetSnapshot): WorkingOrigin | null => {
  const root = rootOf(target);
  return root === null ? null : { ...root, work: target.work };
};

export const atOf = (target: TargetSnapshot): TargetAt => ({
  threadId: target.work.threadId,
  runId: target.runId,
  generation: target.generation,
});

export const ThreadTargetOperationKey = Schema.NonEmptyString.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^[A-Za-z0-9._-]+$/u),
  Schema.isPattern(/^(?!\.{1,2}$)/u),
).pipe(Schema.brand('ThreadTargetOperationKey'));
export type ThreadTargetOperationKey = typeof ThreadTargetOperationKey.Type;

import type { AssignmentActor } from '../../../workspace/contract/wire/assignments.js';

export const CHANGE_FIELDS = {
  operationKey: ThreadTargetOperationKey.annotate({
    description: 'Your own name for this move, chosen before the call. The same name answers the same move.',
  }),
  expectedSelectionRevision: Schema.optional(SelectionRevision).annotate({
    description: 'The selection revision this move was decided against. Omitted: whatever stands.',
  }),
  expectedGeneration: Schema.optional(WorkspaceGeneration).annotate({
    description: 'The active generation this move leaves. Omitted: whatever the run has reached.',
  }),
  root: RootBinding.annotate({
    description: 'The registered root the thread works next, at the location revision read.',
  }),
  creationOperationId: Schema.optional(Schema.NonEmptyString).annotate({
    description: 'An already-recorded creation whose checkout this move enters. Composed from its owning operation, never created here.',
  }),
} as const;

export const READ_FIELDS = {
  operationKey: Schema.optional(ThreadTargetOperationKey).annotate({
    description: 'The move to read. Omitted: where the thread stands now.',
  }),
} as const;

export const ThreadTargetPending = Schema.Struct({
  status: Schema.Literal('pending'),
  operationKey: ThreadTargetOperationKey,
  requestId: Schema.NonEmptyString,
  fromGeneration: WorkspaceGeneration,
});
export type ThreadTargetPending = typeof ThreadTargetPending.Type;

export const ThreadTargetSelected = Schema.Struct({
  status: Schema.Literal('selected'),
  operationKey: ThreadTargetOperationKey,
  revision: SelectionRevision,
});
export type ThreadTargetSelected = typeof ThreadTargetSelected.Type;

export const ThreadTargetApplied = Schema.Struct({
  status: Schema.Literal('applied'),
  operationKey: ThreadTargetOperationKey,
  generation: WorkspaceGeneration,
});
export type ThreadTargetApplied = typeof ThreadTargetApplied.Type;

export const ThreadTargetFailureState = Schema.Struct({
  status: Schema.Literal('failed'),
  operationKey: ThreadTargetOperationKey,
  detail: Schema.String,
});
export type ThreadTargetFailureState = typeof ThreadTargetFailureState.Type;

export const ThreadTargetChange = Schema.Union([ThreadTargetPending, ThreadTargetSelected, ThreadTargetApplied, ThreadTargetFailureState]);
export type ThreadTargetChange = typeof ThreadTargetChange.Type;

export const ThreadTargetRead = Schema.Union([
  Schema.Struct({
    state: Schema.Literal('selected'),
    revision: SelectionRevision,
    rootId: Schema.NullOr(RootId),
  }),
  Schema.Struct({ state: Schema.Literal('effective'), target: TargetSnapshot }),
  Schema.Struct({
    state: Schema.Literal('pending'),
    operationKey: ThreadTargetOperationKey,
    requestId: Schema.NonEmptyString,
    fromGeneration: WorkspaceGeneration,
  }),
  Schema.Struct({
    state: Schema.Literal('failed'),
    operationKey: Schema.NullOr(ThreadTargetOperationKey),
    detail: Schema.String,
  }),
]);
export type ThreadTargetRead = typeof ThreadTargetRead.Type;

export const CHANGE_REFUSALS = [
  'changed-payload',
  'stale-revision',
  'stale-generation',
  'denied',
  'not-found',
  'foreign-project',
  'guest-mobility',
  'creation-unknown',
  'creation-mismatch',
  'target-no-destination',
  'target-root-unavailable',
  'target-placement-unreadable',
] as const;

export const READ_REFUSALS = ['not-found', 'foreign-project', 'target-placement-unreadable'] as const;

const ROOT_SOURCE = 'root:';

export const targetSourceKey = (rootId: RootId): string => `${ROOT_SOURCE}${rootId}`;

export const rootOfSourceKey = (sourceKey: string): RootId | null =>
  sourceKey.startsWith(ROOT_SOURCE) && sourceKey.length > ROOT_SOURCE.length ? RootId.make(sourceKey.slice(ROOT_SOURCE.length)) : null;

export type ThreadTargetCaller = {
  readonly projectId: number;
  readonly actor: AssignmentActor;
};

export type ThreadTargetDestination = {
  readonly rootId: RootId;
  readonly locationRevision: LocationRevision;
};

export type ThreadTargetChangeInput = {
  readonly threadId: ThreadId;
  readonly operationKey: ThreadTargetOperationKey;
  readonly expectedSelectionRevision?: SelectionRevision;
  readonly expectedGeneration?: WorkspaceGeneration;
  readonly root: ThreadTargetDestination;
  readonly creationOperationId?: string;
};

export type ThreadTargetReadInput = {
  readonly threadId: ThreadId;
  readonly operationKey?: ThreadTargetOperationKey;
};
