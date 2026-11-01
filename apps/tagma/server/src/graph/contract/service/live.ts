import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { GRAPH_FEED, GRAPH_RECOVERY_FEED, GRAPH_WORK_FEED } from '../wire/feed.js';
import type { HolderCopies } from './holders.js';
import type { GraphRecoveries } from './recovery.js';
import type { ServedGraphs } from './serving.js';

export type GraphLive = LiveDeclaration<
  readonly [typeof GRAPH_FEED, typeof GRAPH_WORK_FEED, typeof GRAPH_RECOVERY_FEED],
  ServedGraphs | GraphRecoveries | HolderCopies
>;
