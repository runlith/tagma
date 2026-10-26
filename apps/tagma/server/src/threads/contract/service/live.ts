import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { THREAD_FEEDS } from '../wire/feeds.js';
import type { ThreadFeeds } from './feeds.js';

export type ThreadFeedList = typeof THREAD_FEEDS;

export type ThreadLive = LiveDeclaration<ThreadFeedList, ThreadFeeds>;
