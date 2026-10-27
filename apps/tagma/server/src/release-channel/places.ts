import { join } from 'node:path';
import { FEED_REPOSITORY, feedAddress } from '../installation/contract/wire/feed.js';

export const FEED = feedAddress(FEED_REPOSITORY);

export type ReleasePlaces = {
  readonly log: string;
  readonly record: string;
  readonly staging: string;
};

export const releasePlaces = (dataPath: string): ReleasePlaces => ({
  log: join(dataPath, 'update.log'),
  record: join(dataPath, 'update.json'),
  staging: join(dataPath, 'update'),
});
