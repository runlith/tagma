import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { WORKTREES_FEED } from '../wire/feed.js';
import type { SPACE_SCAN_FEED } from '../wire/space.js';
import type { WorktreeRows } from './listing.js';
import type { PlaceSpace } from './space.js';

export type WorktreeLive = LiveDeclaration<readonly [typeof WORKTREES_FEED, typeof SPACE_SCAN_FEED], WorktreeRows | PlaceSpace>;
