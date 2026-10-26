import { Effect, Stream } from 'effect';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { AttentionEvent, ThreadList } from '../contract/service/list.js';
import type { PulseCounts, PulseFeedEvent } from '../contract/wire/feeds.js';
import { snapshotFeed } from './snapshotFeed.js';
import { standingOf } from '../events/standing.js';
import type { ThreadSummary } from './summary.js';

type Contribution = PulseCounts & { readonly projectId: number };
type Change = { readonly revision: number; readonly event: AttentionEvent };

const NONE: PulseCounts = { working: 0, awaiting: 0 };

function contributionOf(row: ThreadSummary): Contribution | undefined {
  if (row.archivedAt !== null || row.ownerId !== OPERATOR_PRINCIPAL) return undefined;
  if (standingOf(row)?.kind === 'awaiting') return { projectId: row.projectId, working: 0, awaiting: 1 };
  if (row.life === 'working' || row.life === 'stalled') return { projectId: row.projectId, working: 1, awaiting: 0 };
  return undefined;
}

export const pulseFeed = (list: ThreadList['Service'], capacity: number): Stream.Stream<PulseFeedEvent> =>
  Stream.unwrap(
    Effect.sync(() => {
      const threads = new Map<string, Contribution>();
      const projects = new Map<number, PulseCounts>();
      let revision = 0;
      let coveredThrough = 0;
      const shift = (contribution: Contribution, direction: number): void => {
        const before = projects.get(contribution.projectId) ?? NONE;
        const next = {
          working: before.working + direction * contribution.working,
          awaiting: before.awaiting + direction * contribution.awaiting,
        };
        if (next.working === 0 && next.awaiting === 0) projects.delete(contribution.projectId);
        else projects.set(contribution.projectId, next);
      };
      const all = Effect.fn('ThreadFeeds.pulseSnapshot')(function* () {
        const cut = revision;
        const rows = yield* list.pulse();
        threads.clear();
        projects.clear();
        for (const row of rows) {
          const contribution = contributionOf(row);
          if (contribution === undefined) continue;
          threads.set(row.id, contribution);
          shift(contribution, 1);
        }
        coveredThrough = cut;
        const value: readonly PulseFeedEvent[] = [
          { type: 'all', projects: [...projects].map(([projectId, counts]) => ({ projectId, ...counts })) },
        ];
        return { value, covered: (change: Change) => change.revision <= cut };
      });
      return snapshotFeed(
        (listener: (change: Change) => void) => list.subscribeAttention((event) => listener({ revision: ++revision, event })),
        all,
        Effect.fnUntraced(function* ({ revision: at, event }: Change) {
          if (at <= coveredThrough) return [];
          if (event.kind === 'resync') return (yield* all()).value;
          const id = event.kind === 'removed' ? event.threadId : event.row.id;
          const before = threads.get(id);
          const next = event.kind === 'removed' ? undefined : contributionOf(event.row);
          if (before?.projectId === next?.projectId && before?.working === next?.working && before?.awaiting === next?.awaiting) return [];
          if (before !== undefined) shift(before, -1);
          if (next === undefined) threads.delete(id);
          else {
            threads.set(id, next);
            shift(next, 1);
          }
          const changed = new Set<number>();
          if (before !== undefined) changed.add(before.projectId);
          if (next !== undefined) changed.add(next.projectId);
          return [...changed].map((projectId): PulseFeedEvent => ({ type: 'changed', projectId, ...(projects.get(projectId) ?? NONE) }));
        }),
        capacity,
      ).pipe(Stream.orDie, Stream.flatMap(Stream.fromIterable));
    }),
  );
