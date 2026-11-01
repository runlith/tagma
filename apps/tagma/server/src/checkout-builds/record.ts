import { Schema } from 'effect';
import { installRefusalSchema, nextIssueSchema, thenSchema } from '../installation/contract/wire/next.js';

export const checkoutRunsSchema = Schema.Literals(['tree', 'head', 'other-edits', 'unmeasured-edits', 'other-commit']);
export type CheckoutRuns = typeof checkoutRunsSchema.Type;

export type CheckoutState = {
  readonly path: string;
  readonly head: string | null;
  readonly dirty: boolean;
  readonly subject: string | null;
  readonly changed: number;
  readonly tree: string | null;
  readonly ahead: number | null;
  readonly runs: CheckoutRuns | null;
};

export type CheckoutFrame = {
  readonly instance: string;
  readonly pid: number;
  readonly revision: number;
  readonly readAt: string;
  readonly watched: boolean;
  readonly issue: typeof nextIssueSchema.Type | null;
  readonly checkout: CheckoutState | null;
};

export const buildFromSchema = Schema.Literals(['head', 'tree', 'back']);
export type BuildFrom = typeof buildFromSchema.Type;

export const buildStepSchema = Schema.Literals(['worktree', 'install', 'build', 'back', 'restart']);
export type BuildStep = typeof buildStepSchema.Type;

export const buildRunningSchema = Schema.Struct({
  from: buildFromSchema,
  revision: Schema.String,
  since: Schema.String,
  log: Schema.String,
  then: Schema.NullOr(thenSchema),
  step: buildStepSchema,
  tail: Schema.NullOr(Schema.String),
  usually: Schema.NullOr(Schema.Number),
});
export type BuildRunning = typeof buildRunningSchema.Type;

export const buildEndedSchema = Schema.Struct({
  from: buildFromSchema,
  revision: Schema.String,
  outcome: Schema.Literals(['landed', 'failed', 'stopped']),
  build: Schema.NullOr(Schema.String),
  detail: Schema.String,
  endedAt: Schema.String,
  log: Schema.String,
  since: Schema.NullOr(Schema.String),
  tail: Schema.Array(Schema.String),
  then: Schema.NullOr(thenSchema),
  restartRefused: Schema.NullOr(Schema.String),
  refused: Schema.optional(installRefusalSchema),
});
export type BuildEnded = typeof buildEndedSchema.Type;
