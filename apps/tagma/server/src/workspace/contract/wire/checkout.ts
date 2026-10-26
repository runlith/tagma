import * as Schema from 'effect/Schema';
import { PLACE_REFUSALS } from './refusals.js';
import { feed } from '../../../platform/contract/wire/operation.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { ENTRY_STATUSES as GIT_ENTRY_STATUSES, SEQUENCER_KINDS } from '@runlith/git/vocabulary';
import { RootId } from './ids.js';

export const CheckoutEntryStatus = Schema.Literals(GIT_ENTRY_STATUSES);
export type CheckoutEntryStatus = typeof CheckoutEntryStatus.Type;

export const CheckoutSequencerKind = Schema.Literals(SEQUENCER_KINDS);
export type CheckoutSequencerKind = typeof CheckoutSequencerKind.Type;

export const CheckoutLines = Schema.Union([
  Schema.Struct({ added: Schema.Int, removed: Schema.Int }),
  Schema.Literal('binary'),
  Schema.Literal('unweighed'),
]);
export type CheckoutLines = typeof CheckoutLines.Type;

export const ComparedPath = Schema.Struct({
  path: Schema.NonEmptyString,
  status: CheckoutEntryStatus,
  oldPath: Schema.optional(Schema.NonEmptyString),
  lines: CheckoutLines,
});
export type ComparedPath = typeof ComparedPath.Type;

export const Holder = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('thread'), thread: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('operator') }),
]);
export type Holder = typeof Holder.Type;

export const OPERATOR: Holder = { kind: 'operator' };

export const holderKey = (holder: Holder): string => (holder.kind === 'operator' ? OPERATOR_PRINCIPAL : holder.thread);

export const holderAt = (key: string): Holder => (key === OPERATOR_PRINCIPAL ? OPERATOR : { kind: 'thread', thread: key });

export const NamedHolder = Schema.Struct({
  holder: Holder,
  agentName: Schema.NullOr(Schema.NonEmptyString),
});
export type NamedHolder = typeof NamedHolder.Type;

export const CheckoutHolder = Schema.Struct({
  ...NamedHolder.fields,
  retired: Schema.Boolean,
  writing: Schema.Boolean,
  tasks: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String })),
});
export type CheckoutHolder = typeof CheckoutHolder.Type;

export const CheckoutEntry = Schema.Struct(ComparedPath.fields);
export type CheckoutEntry = typeof CheckoutEntry.Type;

export const CheckoutArea = Schema.Struct({
  entries: Schema.Array(CheckoutEntry),
  added: Schema.Int,
  removed: Schema.Int,
});
export type CheckoutArea = typeof CheckoutArea.Type;

export const CheckoutEntries = Schema.Struct({
  staged: CheckoutArea,
  unstaged: CheckoutArea,
  untracked: CheckoutArea,
  unmerged: CheckoutArea,
});
export type CheckoutEntries = typeof CheckoutEntries.Type;

export const CheckoutComparison = Schema.Struct({
  base: Schema.NonEmptyString,
  mergeBase: Schema.NonEmptyString,
  head: Schema.NonEmptyString,
  entries: Schema.Array(ComparedPath),
  added: Schema.Int,
  removed: Schema.Int,
});
export type CheckoutComparison = typeof CheckoutComparison.Type;

export const CheckoutCoverage = Schema.Struct({
  untracked: Schema.Literals(['all', 'no']),
  paths: Schema.NullOr(Schema.Array(Schema.NonEmptyString)),
});
export type CheckoutCoverage = typeof CheckoutCoverage.Type;

export const CheckoutState = Schema.Struct({
  rootId: RootId,
  path: Schema.NonEmptyString,
  revision: Schema.Int,
  head: Schema.NullOr(Schema.NonEmptyString),
  ref: Schema.NullOr(Schema.NonEmptyString),
  upstream: Schema.NullOr(Schema.NonEmptyString),
  publishTo: Schema.NullOr(Schema.NonEmptyString),
  ahead: Schema.NullOr(Schema.Int),
  behind: Schema.NullOr(Schema.Int),
  operation: CheckoutSequencerKind,
  entries: CheckoutEntries,
  compare: Schema.NullOr(CheckoutComparison),
  unresolvedBase: Schema.NullOr(Schema.NonEmptyString),
  coverage: CheckoutCoverage,
  repository: Schema.Boolean,
  incomplete: Schema.Boolean,
  stale: Schema.Boolean,
  unwatched: Schema.Boolean,
  slowStatus: Schema.Boolean,
});
export type CheckoutState = typeof CheckoutState.Type;

export const CHECKOUT_FEED = feed('checkout.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    root: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    base: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  }),
  event: CheckoutState,
  refusals: PLACE_REFUSALS,
  callers: 'any',
  admission: 'project',
});
