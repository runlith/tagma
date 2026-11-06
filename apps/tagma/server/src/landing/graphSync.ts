import { Effect } from 'effect';
import type { GraphSync } from './contract/wire/receipt.js';
import { GateRefusal, type OpenRefusal } from '../platform/contract/wire/refusal.js';
import type { GraphPool } from '../graph/serving/pool.js';
import type { ServedGraphs } from '../graph/contract/service/serving.js';
import type { TwinBehind } from './contract/service/graphSyncing.js';

type Synced = NonNullable<Effect.Success<ReturnType<GraphPool['freshnessGate']['topology']>>>;

const syncedOf = (synced: Synced): GraphSync => ({
  status: 'synced',
  copyFailures: synced.copyFailures,
  merges: synced.merges.map((merge) => ({ branch: merge.branch, merged: merge.merged, conflicts: [...merge.conflicts] })),
});

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
      Effect.flatMap((served): Effect.Effect<GraphSync, GateRefusal<OpenRefusal>> => {
        if (served.layout.mode === 'stealth')
          return Effect.map(pool.freshnessGate.topology(served.layout.treeRoot), (synced): GraphSync =>
            synced === null ? { status: 'unread', reason: 'the served graph of this checkout keeps no branch twins' } : syncedOf(synced),
          );
        const layer = served.stealth?.tree() ?? null;
        if (layer === null) return Effect.as(served.settled(true), { status: 'carried' as const });
        const team = pool.freshnessGate.settled(served.layout.treeRoot, true);
        return Effect.flatMap(pool.freshnessGate.topology(layer.layout.treeRoot), (synced) => {
          if (synced === null) return Effect.as(team, { status: 'carried' as const });
          if (synced.merges.some((merge) => merge.conflicts.length > 0)) return Effect.succeed(syncedOf(synced));
          return Effect.as(team, syncedOf(synced));
        });
      }),
      Effect.catchTag('GateRefusal', (refusal) => Effect.succeed<GraphSync>({ status: 'unread', reason: refusal.message })),
    );
