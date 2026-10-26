import * as Schema from 'effect/Schema';
import { CheckoutEntryStatus, Holder } from '../../../workspace/contract/wire/checkout.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { feed } from '../../../platform/contract/wire/operation.js';

export const HoldingGit = Schema.Union([CheckoutEntryStatus, Schema.Literal('ignored'), Schema.Null]);
export type HoldingGit = typeof HoldingGit.Type;

export const LineCounts = Schema.Struct({ added: Schema.Int, removed: Schema.Int });
export type LineCounts = typeof LineCounts.Type;

export const HoldingLines = Schema.Union([LineCounts, Schema.Literal('unweighed')]);
export type HoldingLines = typeof HoldingLines.Type;

export const Hand = Schema.Struct({
  holder: Holder,
  added: Schema.Int,
  removed: Schema.Int,
  writing: Schema.Boolean,
  retired: Schema.Boolean,
});
export type Hand = typeof Hand.Type;

export const NobodyWhy = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('external') }),
  Schema.Struct({ kind: Schema.Literal('steps'), commit: Schema.NonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal('unattributed'),
    windows: Schema.Array(
      Schema.Struct({ thread: Schema.NonEmptyString, reason: Schema.String, team: Schema.NullOr(Schema.NonEmptyString) }),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal('released'), thread: Schema.NonEmptyString, reason: Schema.String }),
]);
export type NobodyWhy = typeof NobodyWhy.Type;

export const Nobody = Schema.Struct({ added: Schema.Int, removed: Schema.Int, why: NobodyWhy });
export type Nobody = typeof Nobody.Type;

export const UnprovenReason = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('budget') }),
  Schema.Struct({
    kind: Schema.Literal('opaque'),
    side: Schema.Literals(['base', 'head', 'working', 'before', 'after', 'projection']),
    row: Schema.NullOr(Schema.String),
    cause: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal('worker'), cause: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('unread'),
    side: Schema.Literals(['base', 'head', 'working', 'before', 'after', 'record', 'status']),
    cause: Schema.String,
  }),
]);
export type UnprovenReason = typeof UnprovenReason.Type;

export const HoldingVerdict = Schema.Union([
  Schema.Struct({ verdict: Schema.Literal('proven'), hands: Schema.Array(Hand), nobody: Schema.Array(Nobody) }),
  Schema.Struct({ verdict: Schema.Literal('unknown'), reason: UnprovenReason, writers: Schema.Array(Holder) }),
]);
export type HoldingVerdict = typeof HoldingVerdict.Type;

export const Holding = Schema.Struct({
  path: Schema.NonEmptyString,
  from: Schema.NullOr(Schema.NonEmptyString),
  git: HoldingGit,
  verdict: HoldingVerdict,
  lines: HoldingLines,
});
export type Holding = typeof Holding.Type;

export const HoldingsState = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('current') }),
  Schema.Struct({ kind: Schema.Literal('opening'), paths: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal('judging'), paths: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal('stale'), reason: Schema.String }),
]);
export type HoldingsState = typeof HoldingsState.Type;

export const CheckoutTotals = Schema.Struct({
  paths: Schema.Int,
  held: Schema.Int,
  operator: Schema.Int,
  nobody: Schema.Int,
  unproven: Schema.Int,
});
export type CheckoutTotals = typeof CheckoutTotals.Type;

export const ThreadTotals = Schema.Struct({ paths: Schema.Int, unproven: Schema.Int, outside: Schema.Int });
export type ThreadTotals = typeof ThreadTotals.Type;

export const ThreadHeld = Schema.Struct({ paths: Schema.Int, unproven: Schema.Int });
export type ThreadHeld = typeof ThreadHeld.Type;

export const HoldingsView = Schema.Struct({
  checkout: Schema.NonEmptyString,
  revision: Schema.Int,
  head: Schema.NullOr(Schema.String),
  row: Schema.NullOr(Schema.Int),
  state: HoldingsState,
  paths: Schema.Array(Holding),
  totals: CheckoutTotals,
});
export type HoldingsView = typeof HoldingsView.Type;

const FrameHead = {
  checkout: RootId,
  revision: Schema.Int,
  head: Schema.NullOr(Schema.String),
  row: Schema.NullOr(Schema.Int),
  state: HoldingsState,
  totals: CheckoutTotals,
};

export const HoldingsFrame = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('whole'), ...FrameHead, paths: Schema.Array(Holding) }),
  Schema.Struct({
    kind: Schema.Literal('change'),
    ...FrameHead,
    changed: Schema.Array(Holding),
    gone: Schema.Array(Schema.NonEmptyString),
  }),
]);
export type HoldingsFrame = typeof HoldingsFrame.Type;

export const HOLDINGS_FEED = feed('holdings.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    root: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  }),
  event: HoldingsFrame,
  refusals: [...PLACE_REFUSALS, 'record-unread'],
  callers: 'any',
  admission: 'project',
});
