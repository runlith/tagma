import * as Schema from 'effect/Schema';
import { Holding, ThreadHeld } from './holdings.js';
import { ChangeCommit, LineEnd, ThreadCheckout } from './threadChanges.js';

export const TurnPath = Schema.Struct({
  runId: Schema.NullOr(Schema.String),
  checkout: Schema.String,
  path: Schema.String,
  at: Schema.Number,
  state: Schema.Literals(['writing', 'held', 'cleared', 'committed', 'withdrawn']),
  commit: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
});
export type TurnPath = typeof TurnPath.Type;

export const PathHolding = Schema.Struct({
  checkout: Schema.String,
  holding: Holding,
  debts: Schema.Array(Schema.String),
});
export type PathHolding = typeof PathHolding.Type;

export const UnattributedPath = Schema.Struct({
  checkout: Schema.String,
  path: Schema.String,
  reason: Schema.String,
  thread: Schema.String,
  team: Schema.NullOr(Schema.String),
});
export type UnattributedPath = typeof UnattributedPath.Type;

export const ChangeTotals = Schema.Struct({
  checkouts: Schema.Number,
  turns: Schema.Number,
  holdings: Schema.Number,
  unattributed: Schema.Number,
});
export type ChangeTotals = typeof ChangeTotals.Type;

export const ChangesRead = {
  path: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  subject: Schema.NullOr(Schema.String),
  self: Schema.NullOr(Schema.String),
  held: Schema.NullOr(ThreadHeld),
  checkouts: Schema.Array(ThreadCheckout),
  commits: Schema.Array(ChangeCommit),
  moreCommits: Schema.Boolean,
  ends: Schema.Array(LineEnd),
  turns: Schema.Array(TurnPath),
  holdings: Schema.Array(PathHolding),
  unattributed: Schema.Array(UnattributedPath),
  totals: ChangeTotals,
  total: Schema.Number,
  next: Schema.NullOr(Schema.String),
};

export const ThreadHistoryRead = {
  turns: Schema.Array(TurnPath),
  total: Schema.Number,
  next: Schema.NullOr(Schema.String),
};

export const ChangesAnswer = Schema.Struct(ChangesRead);
export type ChangesAnswer = typeof ChangesAnswer.Type;
