import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { newHostSchema } from './newHost.js';

export const nextIssueCodeSchema = Schema.Literals(['source-unreadable', 'offline', 'platform-unavailable']);
export type NextIssueCode = typeof nextIssueCodeSchema.Type;

export const nextIssueSchema = Schema.Struct({
  code: nextIssueCodeSchema,
  reason: Schema.String,
  unblock: Schema.NonEmptyArray(Schema.String),
});
export type NextIssue = typeof nextIssueSchema.Type;

export const saidSchema = Schema.Struct({ text: Schema.String, strong: Schema.Boolean });
export type Said = typeof saidSchema.Type;

export const nextStandingSchema = Schema.Struct({
  tone: Schema.Literals(['latest', 'behind', 'apart', 'alone']),
  said: Schema.Array(saidSchema),
  behind: Schema.NullOr(Schema.String),
  behindBy: Schema.optional(Schema.Int),
});
export type NextStanding = typeof nextStandingSchema.Type;

export const nextOfferSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String.annotate({
    description: 'What kind of installation it is, the same for every offer of its kind: Latest commit, Release.',
  }),
  detail: Schema.String,
  label: Schema.String.annotate({ description: 'Which one it is: a commit, a version; empty when the kind alone names it.' }),
  size: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  irreversible: Schema.NullOr(Schema.Boolean),
  current: Schema.Boolean,
  disabled: Schema.NullOr(Schema.String).annotate({ description: 'Why it cannot be chosen now, in the words of a person.' }),
  why: Schema.NullOr(Schema.String).annotate({ description: 'What made it disabled, for an agent or a report.' }),
  update: Schema.String,
  install: Schema.String,
});
export type NextOffer = typeof nextOfferSchema.Type;

export const thenSchema = Schema.Literals(['restart']);
export type Then = typeof thenSchema.Type;

export const nextStepSchema = Schema.Struct({ id: Schema.String, title: Schema.String, weight: Schema.Number });
export type NextStep = typeof nextStepSchema.Type;

const byteCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const installProgressSchema = Schema.Struct({ done: byteCount, total: Schema.NullOr(byteCount) });
export type InstallProgress = typeof installProgressSchema.Type;

export const installingSchema = Schema.Struct({
  offer: Schema.String,
  title: Schema.String,
  target: Schema.String,
  since: Schema.String,
  log: Schema.String,
  then: Schema.NullOr(thenSchema),
  steps: Schema.Array(nextStepSchema),
  step: Schema.String,
  progress: Schema.NullOr(installProgressSchema),
  tail: Schema.NullOr(Schema.String),
  usually: Schema.NullOr(Schema.Number),
});
export type Installing = typeof installingSchema.Type;

export const installRefusalSchema = Schema.Struct({
  code: Schema.String,
  reason: Schema.String,
  unblock: Schema.Array(Schema.String),
});
export type InstallRefusal = typeof installRefusalSchema.Type;

export const installedSchema = Schema.Struct({
  offer: Schema.String,
  title: Schema.String,
  target: Schema.String,
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
export type Installed = typeof installedSchema.Type;

export const machineActSchema = Schema.Struct({
  act: Schema.Literals(['restart', 'stop', 'command']),
  command: Schema.String,
  disabled: Schema.NullOr(Schema.String),
});
export type MachineAct = typeof machineActSchema.Type;

export const nextFrameSchema = Schema.Struct({
  instance: Schema.String,
  pid: Schema.Int,
  revision: Schema.Int,
  readAt: Schema.String,
  readFrom: Schema.NullOr(Schema.String),
  watched: Schema.Boolean,
  issue: Schema.NullOr(nextIssueSchema),
  standing: nextStandingSchema,
  offers: Schema.Array(nextOfferSchema),
  update: Schema.NullOr(Schema.String).annotate({
    description: 'The id of the offer that updates what runs, or null when none moves it forward.',
  }),
  back: Schema.NullOr(nextOfferSchema),
  installing: Schema.NullOr(installingSchema),
  installed: Schema.NullOr(installedSchema),
  acts: Schema.Array(machineActSchema),
  newHost: Schema.optional(newHostSchema).annotate({
    description:
      'On a frame of the installation.next feed: what read_machine_state answers as newHost, sent again whenever it appears, changes or goes; its ends are measured when it changed.',
  }),
});
export type NextFrame = typeof nextFrameSchema.Type;

export const installAskSchema = Schema.Struct({ offer: Schema.String, then: Schema.optional(thenSchema) });

export const NEXT_FEED = feed('installation.next', {
  input: Schema.Struct({}),
  event: nextFrameSchema,
  refusals: nextIssueCodeSchema.literals,
  callers: 'operator',
});
