import { Effect } from 'effect';
import type { GraphSync } from './contract/wire/merge.js';
import type { GateRefusal, OpenRefusal } from '../platform/contract/wire/refusal.js';
import type { GraphPool } from '../graph/serving/pool.js';

export const graphSyncOf =
  (pool: GraphPool) =>
  (projectId: number, checkout: string): Effect.Effect<GraphSync> =>
    pool.resolve({ projectId, cwd: checkout }).pipe(
      Effect.flatMap((served): Effect.Effect<GraphSync, GateRefusal<OpenRefusal>> =>
        served.layout.mode === 'team'
          ? Effect.as(served.settled(), { status: 'carried' as const })
          : Effect.map(pool.freshnessGate.topology(served.layout.treeRoot), (synced): GraphSync =>
              synced === null
                ? { status: 'unread', reason: 'the served graph of this checkout keeps no branch twins' }
                : {
                    status: 'synced',
                    copyFailures: synced.copyFailures,
                    merges: synced.merges.map((merge) => ({
                      branch: merge.branch,
                      merged: merge.merged,
                      conflicts: [...merge.conflicts],
                    })),
                  },
            ),
      ),
      Effect.catchTag('GateRefusal', (refusal) => Effect.succeed<GraphSync>({ status: 'unread', reason: refusal.message })),
    );
