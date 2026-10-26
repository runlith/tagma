import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { PAGE_FEED, THREAD_PAGES_FEED } from '../wire/feed.js';
import type { ArtifactStore } from './shelf.js';
import type { Videos } from './videos.js';

export type ArtifactsLive = LiveDeclaration<readonly [typeof THREAD_PAGES_FEED, typeof PAGE_FEED], ArtifactStore | Videos>;
