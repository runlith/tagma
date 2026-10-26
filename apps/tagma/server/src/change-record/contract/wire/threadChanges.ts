import * as Schema from 'effect/Schema';
import { feed } from '../../../platform/contract/wire/operation.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { Holder } from '../../../workspace/contract/wire/checkout.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { HoldingGit, HoldingLines, HoldingsState, LineCounts, ThreadHeld, UnprovenReason } from './holdings.js';

export const OtherHand = Schema.Struct({ holder: Holder, retired: Schema.Boolean });
export type OtherHand = typeof OtherHand.Type;

export const ThreadEntry = Schema.Union([
  Schema.Struct({
    section: Schema.Literal('uncommitted'),
    path: Schema.NonEmptyString,
    from: Schema.NullOr(Schema.NonEmptyString),
    git: HoldingGit,
    lines: HoldingLines,
    writing: Schema.Boolean,
    others: Schema.Array(OtherHand),
    nobody: Schema.Boolean,
  }),
  Schema.Struct({
    section: Schema.Literal('unproven'),
    path: Schema.NonEmptyString,
    from: Schema.NullOr(Schema.NonEmptyString),
    git: HoldingGit,
    reason: UnprovenReason,
    writers: Schema.Array(Holder),
  }),
  Schema.Struct({
    section: Schema.Literal('outside'),
    path: Schema.NonEmptyString,
    lines: HoldingLines,
    writing: Schema.Boolean,
  }),
]);
export type ThreadEntry = typeof ThreadEntry.Type;

const CheckoutHead = {
  checkout: RootId,
  projectId: Schema.NullOr(Schema.Int),
  root: Schema.NonEmptyString,
  branch: Schema.NullOr(Schema.NonEmptyString),
  revision: Schema.Int,
  state: HoldingsState,
  uncommitted: LineCounts,
};

export const ThreadCheckout = Schema.Struct({ ...CheckoutHead, entries: Schema.Array(ThreadEntry) });
export type ThreadCheckout = typeof ThreadCheckout.Type;

export const ThreadCheckoutChange = Schema.Struct({
  ...CheckoutHead,
  changed: Schema.Array(ThreadEntry),
  gone: Schema.Array(Schema.NonEmptyString),
});
export type ThreadCheckoutChange = typeof ThreadCheckoutChange.Type;

export const ChangeCommit = Schema.Struct({
  checkout: RootId,
  projectId: Schema.NullOr(Schema.Int),
  sha: Schema.NonEmptyString,
  subject: Schema.String,
  author: Schema.String,
  date: Schema.NonEmptyString,
  files: Schema.Int,
});
export type ChangeCommit = typeof ChangeCommit.Type;

export const LineEndReason = Schema.Literals(['reverted', 'overwritten', 'formed', 'thread-deleted', 'checkout-gone', 'outside']);
export type LineEndReason = typeof LineEndReason.Type;

export const LineEnd = Schema.Struct({ reason: LineEndReason, paths: Schema.Int });
export type LineEnd = typeof LineEnd.Type;

export const CHANGE_COMMITS = 30;

export const CHANGE_COMMITS_CEILING = 100;

export const ChangeCommitLimit = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(CHANGE_COMMITS_CEILING));

export const ThreadChangesFrame = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('whole'),
    threadId: Schema.NonEmptyString,
    held: ThreadHeld,
    uncommitted: LineCounts,
    checkouts: Schema.Array(ThreadCheckout),
    commits: Schema.Array(ChangeCommit),
    moreCommits: Schema.Boolean,
    ends: Schema.Array(LineEnd),
  }),
  Schema.Struct({
    kind: Schema.Literal('change'),
    threadId: Schema.NonEmptyString,
    held: ThreadHeld,
    uncommitted: LineCounts,
    checkouts: Schema.Array(ThreadCheckoutChange),
    gone: Schema.Array(RootId),
    commits: Schema.optional(Schema.Struct({ list: Schema.Array(ChangeCommit), more: Schema.Boolean })),
    ends: Schema.optional(Schema.Array(LineEnd)),
  }),
]);
export type ThreadChangesFrame = typeof ThreadChangesFrame.Type;

export const THREAD_CHANGES_FEED = feed('thread.changes', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    threadId: Schema.String.check(Schema.isMinLength(1)),
    commits: Schema.optional(ChangeCommitLimit),
  }),
  event: ThreadChangesFrame,
  refusals: [...PLACE_REFUSALS, 'record-unread'],
  callers: 'any',
  admission: 'project',
});
