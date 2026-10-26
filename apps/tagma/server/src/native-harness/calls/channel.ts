import { Stream } from 'effect';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { CallActivity } from '../contract/service/calls.js';
import type { CallEvent } from '@runlith/agent/callProgress';
import type { CallFeedSubscription } from '../contract/wire/calls.js';

export const callChannel = (owners: { readonly activity: CallActivity['Service'] }) => ({
  'calls.subscribe': (params: CallFeedSubscription): Stream.Stream<CallEvent, RefusalBody> =>
    owners.activity.feed({ projectId: params.projectId }, params.ended),
});
