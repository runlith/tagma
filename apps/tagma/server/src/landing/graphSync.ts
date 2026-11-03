import { Effect } from 'effect';
import type { GraphSync } from './contract/wire/merge.js';
import { GateRefusal, type OpenRefusal } from '../platform/contract/wire/refusal.js';
import type { GraphPool } from '../graph/serving/pool.js';
import type { ServedGraphs } from '../graph/contract/service/serving.js';
import type { TwinBehind } from './contract/service/graphSyncing.js';

export const twinBehindOf =
  (served: ServedGraphs['Service']): TwinBehind =>
  (projectId, checkout, branch, base) =>
    Effect.flatMap(served.resolve({ projectId, cwd: checkout }), (graph) => {
      const shadow = graph.shadow;
      if (graph.layout.mode !== 'stealth' || shadow === null) return Effect.succeed(null);
      return shadow.quiet('twin-behind', ['--git-dir', shadow.gitDir, 'rev-list', '--count', `${branch}..${base}`]).pipe(
        Effect.map((count) => (count === null ? null : count.trim() !== '0')),
        Effect.mapError(
          (failure) => new GateRefusal('not-served', failure.message, ['read the graph twins of this project and merge again']),
        ),
      );
    });

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
