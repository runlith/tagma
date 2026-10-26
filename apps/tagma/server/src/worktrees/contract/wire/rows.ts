import * as Schema from 'effect/Schema';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { PendingMerge } from './mergeTypes.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';

export const WORKTREE_HUES = 6;

export const WorktreeHue = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: WORKTREE_HUES - 1 }));

export const WorktreeSetupStatus = Schema.Literals(['none', 'pending', 'running', 'done', 'failed']);
export type WorktreeSetupStatus = typeof WorktreeSetupStatus.Type;

export const WorktreeSetupStep = Schema.Literals(['copy', 'run']);
export type WorktreeSetupStep = typeof WorktreeSetupStep.Type;

export const WorktreeSetupDetail = Schema.Struct({
  step: Schema.NullOr(WorktreeSetupStep),
  operation: Schema.NullOr(Schema.NonEmptyString),
  execution: Schema.NullOr(ExecutionRef),
  reason: Schema.NullOr(Schema.String),
});
export type WorktreeSetupDetail = typeof WorktreeSetupDetail.Type;

export const WorktreeKind = Schema.Literals(['main', 'tagma', 'external']);
export type WorktreeKind = typeof WorktreeKind.Type;

export const WorktreeState = Schema.Literals([
  'missing',
  'conflicts',
  'waiting',
  'working',
  'ready',
  'behind',
  'merged',
  'idle',
  'reading',
  'unread',
]);
export type WorktreeState = typeof WorktreeState.Type;

export const MergeCheck = Schema.Literals(['unknown', 'clean', 'conflicts', 'format-behind']);
export type MergeCheck = typeof MergeCheck.Type;

export const WorktreeReading = Schema.Literals(['pending', 'done', 'failed', 'no-repository']);
export type WorktreeReading = typeof WorktreeReading.Type;

export const WorktreeAgents = Schema.Struct({
  working: Schema.Int,
  waiting: Schema.Int,
  finished: Schema.Int,
  standing: Schema.Int,
});
export type WorktreeAgents = typeof WorktreeAgents.Type;

export const WorktreeFact = Schema.Struct({
  state: Schema.Literals(['current', 'previous', 'queued', 'untaken']),
  indexStamp: Schema.optional(Schema.String),
  driverRevision: Schema.optional(Schema.String),
  fingerprint: Schema.optional(Schema.String),
  head: Schema.NullOr(Schema.String),
  base: Schema.NullOr(Schema.String),
  baseTime: Schema.NullOr(Schema.Number),
  takenAt: Schema.NullOr(Schema.Number),
});
export type WorktreeFact = typeof WorktreeFact.Type;

export const WorktreeRow = Schema.Struct({
  index: Schema.Int,
  missing: Schema.Boolean,
  head: Schema.NullOr(Schema.String),
  headTime: Schema.NullOr(Schema.Number),
  stateFact: WorktreeFact,
  mergeFact: WorktreeFact,
  rootId: RootId,
  kind: WorktreeKind,
  name: Schema.NonEmptyString,
  folder: Schema.NonEmptyString,
  branch: Schema.NullOr(Schema.NonEmptyString),
  base: Schema.NullOr(
    Schema.Struct({
      branch: Schema.NullOr(Schema.NonEmptyString),
      commit: Schema.NonEmptyString,
    }),
  ),
  hue: Schema.NullOr(WorktreeHue),
  status: WorktreeState,
  check: MergeCheck,
  agents: WorktreeAgents,
  ahead: Schema.NullOr(Schema.Int),
  behind: Schema.NullOr(Schema.Int),
  uncommitted: Schema.NullOr(Schema.Int),
  reading: WorktreeReading,
  diff: Schema.NullOr(Schema.Struct({ files: Schema.Int, added: Schema.Int, removed: Schema.Int })),
  threads: Schema.Array(Schema.NonEmptyString),
  setup: WorktreeSetupStatus,
  taskId: Schema.NullOr(Schema.NonEmptyString),
  pending: Schema.NullOr(PendingMerge),
  movedAt: Schema.NullOr(Schema.String),
});
export type WorktreeRow = typeof WorktreeRow.Type;

export const WorktreePlace = Schema.Struct({
  index: Schema.Int,
  rootId: RootId,
  kind: WorktreeKind,
  name: Schema.NonEmptyString,
  folder: Schema.NonEmptyString,
  branch: Schema.NullOr(Schema.NonEmptyString),
  base: Schema.NullOr(Schema.Struct({ branch: Schema.NullOr(Schema.NonEmptyString), commit: Schema.NonEmptyString })),
  hue: Schema.NullOr(WorktreeHue),
  head: Schema.NullOr(Schema.String),
  headTime: Schema.NullOr(Schema.Number),
  missing: Schema.Boolean,
  agents: WorktreeAgents,
  threads: Schema.Array(Schema.NonEmptyString),
  setup: WorktreeSetupStatus,
  taskId: Schema.NullOr(Schema.NonEmptyString),
  pending: Schema.NullOr(PendingMerge),
  movedAt: Schema.NullOr(Schema.String),
});
export type WorktreePlace = typeof WorktreePlace.Type;

export type WorktreeWindow = { readonly start: number; readonly limit: number; readonly places?: boolean };

export const WorktreeElsewhere = Schema.Struct({
  threadId: Schema.NonEmptyString,
  rootId: Schema.NullOr(RootId),
});
export type WorktreeElsewhere = typeof WorktreeElsewhere.Type;

export const WorktreeListAnswer = Schema.Struct({
  rows: Schema.Array(WorktreeRow),
  elsewhere: Schema.Array(WorktreeElsewhere),
  shown: Schema.Int,
  total: Schema.Int,
  next: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
});
export type WorktreeListAnswer = typeof WorktreeListAnswer.Type;

export const WorktreeActKind = Schema.Literals(['delete', 'merge', 'rename', 'update', 'pull-request', 'clean']);
export type WorktreeActKind = typeof WorktreeActKind.Type;

export const WorktreeActPhase = Schema.Literals([
  'waiting',
  'ending',
  'committing',
  'removing',
  'deleting-branch',
  'checking',
  'judging',
  'landing',
  'syncing',
  'checking-out',
  'registering',
  'pushing',
  'opening',
  'renaming',
]);
export type WorktreeActPhase = typeof WorktreeActPhase.Type;

export const WorktreeActivity = Schema.Struct({
  rootId: RootId,
  act: WorktreeActKind,
  phase: Schema.NullOr(WorktreeActPhase),
  since: Schema.String,
});
export type WorktreeActivity = typeof WorktreeActivity.Type;

export const WorktreeFeedEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('list'),
    rows: Schema.Array(WorktreeRow),
    elsewhere: Schema.Array(WorktreeElsewhere),
    start: Schema.Int,
    total: Schema.Int,
    places: Schema.optional(Schema.Array(WorktreePlace)),
  }),
  Schema.Struct({ kind: Schema.Literal('places'), upsert: Schema.Array(WorktreePlace), removed: Schema.Array(RootId) }),
  Schema.Struct({ kind: Schema.Literal('row'), row: WorktreeRow }),
  Schema.Struct({ kind: Schema.Literal('acts'), acts: Schema.Array(WorktreeActivity) }),
]);
export type WorktreeFeedEvent = typeof WorktreeFeedEvent.Type;
