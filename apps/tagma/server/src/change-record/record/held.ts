import { subscribersOf } from '../../platform/subscribers.js';
import { type HeldChange, HeldFeed } from '../contract/service/held.js';

export const heldFeed = (): HeldFeed['Service'] => {
  const feed = subscribersOf<HeldChange>('a held-change subscriber failed', ({ threadId }) => ({ threadId }));
  return HeldFeed.of({ publish: feed.publish, heldChanged: feed.subscribe });
};
