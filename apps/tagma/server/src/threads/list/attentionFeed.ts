import { Effect, Stream } from 'effect';
import type { ProjectChanges } from '../../projects/contract/service/changes.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import type { AttentionEvent, ThreadList } from '../contract/service/list.js';
import type { Attention, AttentionChange } from '../contract/service/attention.js';
import type { AttentionFeedEvent } from '../contract/wire/attention.js';
import { standingOf } from '../events/standing.js';
import { projectNames, attentionRowOf, attentionRows, rankedOf } from './attention.js';
import { AttentionWindow } from './attentionWindow.js';
import { snapshotFeed } from './snapshotFeed.js';

export const attentionChanges = (
  list: ThreadList['Service'],
  projects: Projects['Service'],
  registryChanges: ProjectChanges['Service'],
  capacity: number,
): Attention['Service']['changes'] =>
  Stream.unwrap(
    Effect.sync(() => {
      const named = projectNames(projects);
      const all = Effect.map(attentionRows(list, named), (ranked): AttentionChange => ({
        _tag: 'all',
        rows: ranked.map((entry) => entry.row),
      }));
      const opened = Effect.map(all, (value) => ({ value, covered: () => false }));
      const projected = (event: AttentionEvent) => {
        if (event.kind === 'resync') return all;
        const threadId = event.kind === 'removed' ? event.threadId : event.row.id;
        const gone = Effect.succeed<AttentionChange>({ _tag: 'gone', threadId });
        if (event.kind === 'removed' || standingOf(event.row) === null) return gone;
        const summary = event.row;
        return Effect.flatMap(named(summary.projectId), (project) => {
          const row = project === undefined ? null : attentionRowOf(summary, project);
          return row === null ? gone : Effect.succeed<AttentionChange>({ _tag: 'put', row });
        });
      };
      return snapshotFeed(
        (listener: (event: AttentionEvent) => void) => {
          const threads = list.subscribeAttention(listener);
          const registry = registryChanges.changed.subscribe(Effect.sync(() => listener({ kind: 'resync' })));
          return () => {
            threads();
            registry();
          };
        },
        () => opened,
        projected,
        capacity,
      );
    }),
  );

export const attentionFeed = (changes: Attention['Service']['changes'], rows: number): Stream.Stream<AttentionFeedEvent> =>
  Stream.unwrap(
    Effect.sync(() => {
      const window = new AttentionWindow(rows);
      return changes.pipe(
        Stream.orDie,
        Stream.map((change) => {
          if (change._tag === 'all') return window.open(change.rows.map(rankedOf));
          if (change._tag === 'gone') return window.drop(change.threadId);
          return window.put(rankedOf(change.row));
        }),
        Stream.filter((event): event is AttentionFeedEvent => event !== null),
      );
    }),
  );
