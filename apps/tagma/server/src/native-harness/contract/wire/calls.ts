import { Schema } from 'effect';
import { CallEvent } from '@runlith/agent/callProgress';
import { feed } from '../../../platform/contract/wire/operation.js';

export const CallFeedSubscription = Schema.Struct({
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  ended: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type CallFeedSubscription = typeof CallFeedSubscription.Type;

export const CALLS_FEED = feed('calls.subscribe', {
  input: CallFeedSubscription,
  event: CallEvent,
  refusals: ['not-found'],
  callers: 'operator',
  admission: 'project',
});
