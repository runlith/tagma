import { Context, Effect, Layer, Queue, Tracer } from 'effect';
import { createKeyedEventEmitter } from '@runlith/utils/event';
import { GraphFeed, GraphJournal, type GraphFrame } from '../contract/service/journal.js';
import { wireEvent, wireTreeBlock } from '../reading/rows.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { type ActEntry, type BlockRecord, type EdgeRow, BlockNames, BlockReferences, CommitEffects } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { SessionNames } from '../contract/service/orientation.js';
import { journalSessions } from './writers.js';
import { blocksOf } from './eventLog.js';
import { Selection } from '../contract/service/reads.js';
import { Edges, Trash } from '../contract/service/blocks.js';
import { blockName } from '../contract/wire/references.js';
import type { Edge } from '../contract/wire/rows.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { mirrorRevision } from '../tree/mirror.js';

type Group = { readonly events: ActEntry[]; readonly rows: BlockRecord[]; readonly unreadable: number[] };

export const graphFeedLayer: Layer.Layer<
  GraphFeed,
  never,
  Selection | Trash | Edges | BlockNames | BlockReferences | GraphJournal | WriterRegister | SessionNames | Tags | GraphStore
> = Layer.effect(
  GraphFeed,
  Effect.gen(function* () {
    const selection = yield* Selection;
    const trash = yield* Trash;
    const edges = yield* Edges;
    const names = yield* BlockNames;
    const references = yield* BlockReferences;
    const journal = yield* GraphJournal;
    const register = yield* WriterRegister;
    const writerNames = yield* SessionNames;
    const vocabulary = yield* Tags;
    const store = yield* GraphStore;
    const wake = yield* Queue.dropping<void>(1);
    const changes = createKeyedEventEmitter<number, [GraphFrame]>((error) =>
      Effect.runSync(Effect.logWarning('a graph feed listener failed', error)),
    );
    const tables = new Map<number, TagTable>();
    let lastPublishedId = 0;
    let seenMirror: string | null = null;
    const mirror = Effect.provideService(mirrorRevision(), GraphStore, store);

    const writers = Effect.fnUntraced(function* (
      projectId: number,
      events: readonly { sessionId: number | null }[],
      blocks: readonly BlockRecord[],
    ) {
      const table = yield* vocabulary.of(projectId);
      const ids = [...events.map((entry) => entry.sessionId), ...blocks.map((row) => table.holderOf(row))].filter(
        (id): id is number => id !== null,
      );
      return yield* journalSessions(writerNames, projectId, yield* register.named(ids));
    });

    const change = Effect.fn('GraphFeed.change')(function* (projectId: number, group: Group, uuidById: ReadonlyMap<number, string>) {
      const touched = new Set(group.rows.map((row) => row.id));
      const near = yield* edges.of(projectId, touched);
      const readers = new Set<number>();
      const table = tables.get(projectId) ?? (yield* vocabulary.of(projectId));
      for (const row of near) {
        const meaning = table.edgeRule(row.kind)?.meaning;
        if (meaning === 'dependency' && touched.has(row.toId)) readers.add(row.fromId);
        if ((meaning === 'implementation' || row.kind === 'discovered-from') && touched.has(row.fromId)) readers.add(row.toId);
      }
      for (const id of touched) readers.delete(id);
      const added = readers.size === 0 ? [] : (yield* selection.records([...readers])).filter((row) => row.projectId === projectId);
      const blocks = [...group.rows, ...added];
      const ids = blocks.map((row) => row.id);
      const edgeRows =
        added.length === 0 ? near : distinct([...near, ...(yield* edges.of(projectId, new Set(added.map((row) => row.id))))]);
      const [named, refs, sessions, ready, roots] = yield* Effect.all(
        [
          names.namesOf([...new Set(edgeRows.flatMap((row) => [row.fromId, row.toId]))]),
          references.refsOf(projectId, new Set(ids)),
          writers(projectId, group.events, blocks),
          selection.ready({ projectId, among: ids }),
          trash.roots(projectId, ids),
        ],
        { concurrency: 'unbounded' },
      );
      return {
        type: 'change' as const,
        projectId,
        events: yield* Effect.forEach(group.events, (entry) => wireEvent(entry, uuidById.get(entry.blockId ?? -1) ?? null)),
        unreadable: group.unreadable.length === 0 ? undefined : group.unreadable,
        blocks: blocks.map(wireTreeBlock),
        edges: edgeRows.flatMap((row) => wireNamed(row, named)),
        refs,
        sessions,
        ready: ready.map((row) => blockName(row.uuid)),
        trash: roots.map(wireTreeBlock),
      };
    });

    const deliver = Effect.fn('GraphFeed.deliver')(function* (slice: readonly ActEntry[], resynced: ReadonlySet<number>) {
      const rows = yield* selection.records([...new Set(slice.flatMap((entry) => blocksOf(entry).ids))]);
      const projectOf = new Map(rows.map((row) => [row.id, row.projectId]));
      const uuidById = new Map(rows.map((row) => [row.id, row.uuid]));
      const grouped = new Map<number, Group>();
      const groupOf = (projectId: number): Group => {
        const known = grouped.get(projectId);
        if (known !== undefined) return known;
        const group: Group = { events: [], rows: [], unreadable: [] };
        grouped.set(projectId, group);
        return group;
      };
      for (const row of rows) groupOf(row.projectId).rows.push(row);
      for (const entry of slice) {
        const projectId = entry.blockId === null ? undefined : projectOf.get(entry.blockId);
        if (projectId === undefined) continue;
        const group = groupOf(projectId);
        group.events.push(entry);
        if (blocksOf(entry).unreadable !== null) group.unreadable.push(entry.id);
      }
      for (const [projectId, group] of grouped) {
        if (resynced.has(projectId) || !changes.keys().includes(projectId)) continue;
        changes.emit(projectId, yield* change(projectId, group, uuidById));
      }
    });

    let reached = 0;
    const publish = Effect.fn('GraphFeed.publish')(
      function* () {
        reached = lastPublishedId;
        if (changes.size === 0) return;
        const revision = yield* mirror;
        const moved = seenMirror !== null && revision !== seenMirror;
        seenMirror = revision;
        const resynced = new Set<number>(moved ? changes.keys() : []);
        for (const projectId of changes.keys()) {
          const table = yield* vocabulary.of(projectId);
          const seen = tables.get(projectId);
          tables.set(projectId, table);
          if (seen !== undefined && seen !== table) resynced.add(projectId);
        }
        for (const projectId of resynced) changes.emit(projectId, { type: 'resync' });
        const slice = [...(yield* journal.events({ sinceId: lastPublishedId }))].reverse();
        reached = slice.at(-1)?.id ?? reached;
        if (slice.length > 0) yield* deliver(slice, resynced);
        lastPublishedId = Math.max(lastPublishedId, reached);
      },
      Effect.catchCause((cause) =>
        Effect.andThen(
          Effect.logError('the graph feed could not publish, so every subscriber resyncs', cause),
          Effect.sync(() => {
            for (const projectId of changes.keys()) changes.emit(projectId, { type: 'resync' });
            lastPublishedId = Math.max(lastPublishedId, reached);
          }),
        ),
      ),
    );

    yield* Effect.forkScoped(
      Effect.updateContext(Effect.forever(Effect.andThen(Queue.take(wake), () => publish())), (context: Context.Context<never>) =>
        Context.omit(Tracer.ParentSpan)(context),
      ),
    );

    return GraphFeed.of({
      subscribe: Effect.fnUntraced(function* (projectId, listener) {
        if (changes.size === 0) {
          const read = yield* Effect.result(Effect.all([journal.events({ limit: 1 }), mirror]));
          if (read._tag === 'Failure') {
            yield* Effect.logWarning('the graph feed could not read the journal for its starting point, so it replays from the beginning', {
              projectId,
              reason: read.failure.message,
            });
          } else {
            lastPublishedId = read.success[0][0]?.id ?? 0;
            seenMirror = read.success[1];
          }
        }
        if (!changes.keys().includes(projectId)) {
          const table = yield* Effect.result(vocabulary.of(projectId));
          if (table._tag === 'Success') tables.set(projectId, table.success);
          else {
            tables.delete(projectId);
            yield* Effect.logWarning('the graph feed could not read the vocabulary, so its next change resyncs nobody', {
              projectId,
              reason: table.failure.message,
            });
          }
        }
        return changes.subscribe(projectId, listener);
      }),
      flush: () => Effect.asVoid(Queue.offer(wake, undefined)),
    });
  }),
);

export const commitHooksLayer: Layer.Layer<never, never, GraphFeed> = Layer.effect(
  CommitEffects,
  Effect.map(GraphFeed, (feed) => [feed.flush()]),
);

function distinct(rows: readonly EdgeRow[]): EdgeRow[] {
  const seen = new Map<string, EdgeRow>();
  for (const row of rows) seen.set(`${row.fromId}:${row.kind}:${row.toId}`, row);
  return [...seen.values()];
}

function wireNamed(row: EdgeRow, names: ReadonlyMap<number, string>): Edge[] {
  const fromName = names.get(row.fromId);
  const toName = names.get(row.toId);
  if (fromName === undefined || toName === undefined) return [];
  return [{ fromName, toName, kind: row.kind, createdBySessionId: row.createdBySessionId, createdAt: row.createdAt.toISOString() }];
}
