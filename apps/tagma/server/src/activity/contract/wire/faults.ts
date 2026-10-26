import { family } from '@runlith/paging';
import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';

export const Fault = Schema.Struct({
  fingerprint: Schema.String,
  kind: Schema.Literals(['defect', 'degraded']),
  place: Schema.String,
  message: Schema.String,
  stack: Schema.NullOr(Schema.String),
  count: Schema.Int,
  firstAt: Schema.Number,
  lastAt: Schema.Number,
  activity: Schema.String,
  thread: Schema.NullOr(Schema.String),
  run: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.Int),
});
export type Fault = typeof Fault.Type;

export const FaultsLoss = Schema.Struct({
  scope: Schema.optional(Schema.Literal('global')),
  unknown: Schema.optional(Schema.Boolean),
  cause: Schema.String,
  facts: Schema.Int,
  bodies: Schema.Int,
  bytes: Schema.Int,
});

export const FaultsPage = Schema.Struct({
  faults: Schema.Array(Fault),
  total: Schema.Int,
  since: Schema.Number,
  lost: Schema.Array(FaultsLoss),
});
export type FaultsPage = typeof FaultsPage.Type;

export const FAULT_ROWS = family('faults', 1, 'json', { text: 4_800, json: 4_800 }, 'ceiling', () => ({
  fingerprint: `agent.turn.call\n${'x'.repeat(380)}`,
  kind: 'degraded',
  place: 'agent.turn.call',
  message: 'x'.repeat(1_000),
  stack: `${'x'.repeat(74)}\n`.repeat(40),
  count: 1_000,
  firstAt: 1_760_896_000_000,
  lastAt: 1_760_896_000_000,
  activity: '01a15555-5e20-7b6d-bc3a-f76be71aec0c',
  thread: '01a15555-5e20-7b6d-bc3a-f76be71aec0c',
  run: '01a15555-5e20-7b6d-bc3a-f76be71aec0c',
  project: 12,
}));

export const FAULTS_FEED_ROWS = 200;

export const FaultsFrame = Schema.Union([
  Schema.Struct({ type: Schema.tag('page'), ...FaultsPage.fields }),
  Schema.Struct({ type: Schema.tag('unreadable'), reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('type'));
export type FaultsFrame = typeof FaultsFrame.Type;

export const FAULTS_FEED = feed('faults.subscribe', {
  input: Schema.Struct({ limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: FAULTS_FEED_ROWS })) }),
  event: FaultsFrame,
  refusals: [],
  callers: 'operator',
});

export const ACTIVITY_FEEDS = [FAULTS_FEED] as const;
