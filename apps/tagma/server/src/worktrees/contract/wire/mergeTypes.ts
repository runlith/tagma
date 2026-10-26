import type { Raised } from '@runlith/agent/permissions';
import * as Schema from 'effect/Schema';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { FinishRefusalRow } from './failures.js';

export const MergeMode = Schema.Literals(['merge', 'squash', 'rebase']);
export type MergeMode = typeof MergeMode.Type;

export const MergeAfter = Schema.Literals(['keep', 'delete']);
export type MergeAfter = typeof MergeAfter.Type;

export const PendingMerge = Schema.Struct({
  rootId: RootId,
  mode: MergeMode,
  message: Schema.NullOr(Schema.NonEmptyString),
  after: MergeAfter,
  state: Schema.Literals(['waiting', 'stopped']),
  queuedAt: Schema.String,
  attempts: Schema.Int,
  refusal: Schema.NullOr(FinishRefusalRow),
  endRunning: Schema.Boolean,
});
export type PendingMerge = typeof PendingMerge.Type;

export type FinishingPlace = { readonly folder: string; readonly base: string | null; readonly consents?: readonly Raised[] };
