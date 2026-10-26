import { join } from 'node:path';

export const FEED = 'https://raw.githubusercontent.com/runlith/tagma/main/feed.json';

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
