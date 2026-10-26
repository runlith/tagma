import { Clock, Effect, Layer } from 'effect';
import { Trash, type Departure, type DeleteRefusal, type GraphAddress, type RestoreRefusal } from '../contract/service/blocks.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, edge, event } from '../store/tables.js';
import { RELATION_EDGES } from '../contract/wire/tags/moduleContract.js';
import { pagesOf } from '../../platform/store/binds.js';
import { Act, BlockNames, BlockProjection, type BlockRecord } from '../contract/service/acts.js';
import { assertMembersStand } from '../vocabulary/catalogs.js';
import { blockName } from '../contract/wire/references.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { journalUnreadable, readJournal } from '../contract/wire/journalPayloads.js';
import { GateRefusal, type FloorRefusal } from '../../platform/contract/wire/refusal.js';
import { readsOf } from '../acts/reads.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { Tags } from '../contract/service/vocabulary.js';
import { BlockRows } from '../acts/rows.js';
import { writes } from '../../platform/contract/service/writes.js';
import { TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { vocabularyCloser } from '../vocabulary/carriers.js';
import { linking, projecting } from '../store/actWrites.js';
import { assertNoBoundary } from './guards.js';

const trashing = writes('Trash.delete', [block], projecting);
const restoring = writes('Trash.restore', [block], projecting);
const departing = writes('Trash.depart', [block], projecting, linking);

export const trashLayer: Layer.Layer<Trash, never, GraphStore | Act | BlockProjection | BlockNames | BlockRows | Tags | GraphUnits> =
  Layer.effect(
    Trash,
    Effect.gen(function* () {
      const { db } = yield* GraphStore;
      const reads = readsOf(yield* GraphUnits);
      const act = yield* Act;
      const blockProjection = yield* BlockProjection;
      const blockRows = yield* BlockRows;
      const vocabulary = yield* Tags;
      const closeVocabulary = yield* vocabularyCloser;

      const trashed = Effect.fnUntraced(function* (input: {
        id: number;
      }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<DeleteRefusal>> {
        const row = yield* blockRows.blockById(input.id);
        if (row.tags.length === 0 && row.parentId === null) {
          return yield* new GateRefusal('project-root', 'the project root is not deleted; remove the project itself', [
            'the registry drops a project after the live tree under it is empty',
          ]);
        }
        const now = new Date(yield* Clock.currentTimeMillis);
        const descendants = yield* blockRows.collectDescendants(row.id);
        yield* assertMembersStand(db, row.projectId, [row, ...descendants]);
        const table = yield* vocabulary.of(row.projectId);
        return yield* act.unit(
          trashing,
          Effect.gen(function* () {
            const falling = [yield* blockRows.blockById(row.id), ...(yield* blockRows.collectDescendants(row.id))];
            yield* assertNoBoundary(table, falling, 'trashed');
            const ids = falling.map((item) => item.id);
            const declaring = falling.some((item) => item.tags.includes(TAG_DECLARATION.id));
            const before = declaring ? yield* vocabulary.of(row.projectId) : table;
            yield* db.update(block).set({ deletedAt: now }).where(inArray(block.id, ids));
            yield* blockProjection.forgetVocabulary(ids);
            if (declaring) yield* closeVocabulary(row.projectId, before, yield* vocabulary.of(row.projectId), null);
            yield* act.record('delete', row.id, { ids }, now);
            const settled = yield* blockRows.rawBlockById(row.id);
            return yield* blockRows.recordOf(settled);
          }),
        );
      });

      const departed = Effect.fnUntraced(function* (input: {
        id: number;
        to: GraphAddress;
      }): Effect.fn.Return<Departure, StoreFailure | GateRefusal<DeleteRefusal | 'relocation-shape'>> {
        const now = new Date(yield* Clock.currentTimeMillis);
        return yield* act.unit(
          departing,
          Effect.gen(function* () {
            const taken = yield* blockRows.blockById(input.id);
            if (taken.tags.length === 0 && taken.parentId === null) {
              return yield* new GateRefusal('project-root', 'the project root does not leave its graph', [
                'move the blocks under it, each with its subtree',
              ]);
            }
            const falling = [taken, ...(yield* blockRows.collectDescendants(taken.id))];
            const ids = falling.map((row) => row.id);
            const uuids = new Map(falling.map((row) => [row.id, row.uuid] as const));
            yield* assertMembersStand(db, taken.projectId, falling);
            for (const page of pagesOf(ids, 1)) {
              for (const link of yield* db.select().from(edge).where(inArray(edge.toId, page))) {
                if (uuids.has(link.fromId)) continue;
                const to = blockName(uuids.get(link.toId) ?? '');
                if (link.kind === 'supersedes' || link.kind === 'amends') {
                  const from = blockName((yield* blockRows.rawBlockById(link.fromId)).uuid);
                  return yield* new GateRefusal('relocation-shape', `${from} ${link.kind} ${to}, and that edge stays in one graph`, [
                    `move ${from} together with ${to}: its own operation writes a ${link.kind} edge, inside one graph`,
                  ]);
                }
                yield* db.delete(edge).where(and(eq(edge.fromId, link.fromId), eq(edge.toId, link.toId), eq(edge.kind, link.kind)));
                yield* act.record('unlink', link.fromId, { kind: link.kind, toId: link.toId }, now);
                if (RELATION_EDGES.includes(link.kind)) continue;
                yield* blockRows.insertFarEdge(link.fromId, link.kind, {
                  graph: input.to.graph,
                  uuid: uuids.get(link.toId) ?? '',
                  label: input.to.label,
                });
              }
            }
            const table = yield* vocabulary.of(taken.projectId);
            const declaring = falling.some((item) => item.tags.includes(TAG_DECLARATION.id));
            for (const row of falling) yield* db.update(block).set({ deletedAt: now, uuid: mintBlockId() }).where(eq(block.id, row.id));
            yield* blockProjection.forgetVocabulary(ids);
            if (declaring) yield* closeVocabulary(taken.projectId, table, yield* vocabulary.of(taken.projectId), null);
            yield* act.record('delete', taken.id, { ids }, now);
            return { taken, resting: yield* blockRows.recordOf(yield* blockRows.rawBlockById(taken.id)) };
          }),
        );
      });

      const restored = Effect.fnUntraced(function* (
        input: { id: number },
        uuid: string | null,
      ): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<RestoreRefusal>> {
        const row = yield* blockRows.rawBlockById(input.id);
        if (row.deletedAt === null) {
          return yield* new GateRefusal('not-deleted', `block ${blockName(row.uuid)} is not in the trash`, [
            'name the ROOT of the batch it fell in: restore_block refuses with every root this project has resting',
          ]);
        }
        if (row.parentId !== null) {
          const parent = yield* blockRows.rawBlockById(row.parentId);
          if (parent.deletedAt !== null) {
            return yield* new GateRefusal('parent-deleted', 'the parent is in the trash; restore it instead', [
              `restore_block ${blockName(parent.uuid)}`,
            ]);
          }
        }
        const deletion = yield* db
          .select()
          .from(event)
          .where(and(eq(event.op, 'delete'), eq(event.blockId, row.id)))
          .orderBy(sql`${event.id} desc`)
          .get();
        if (!deletion) {
          return yield* new GateRefusal('journal-unreadable', `the journal holds no delete event for ${blockName(row.uuid)}`, [
            'the trash batch is unknown; recreate the block instead of restoring it',
          ]);
        }
        const batch = (yield* Effect.mapError(Effect.fromResult(readJournal.trash(deletion)), journalUnreadable)).ids;
        return yield* act.unit(
          restoring,
          Effect.gen(function* () {
            const rising = yield* db
              .select({ uuid: block.uuid, tags: block.tags, fields: block.fields })
              .from(block)
              .where(inArray(block.id, batch));
            yield* assertNoBoundary(yield* vocabulary.of(row.projectId), rising, 'restored');
            const declaring = rising.some((item) => item.tags.includes(TAG_DECLARATION.id));
            const before = declaring ? yield* vocabulary.of(row.projectId) : null;
            yield* db.update(block).set({ deletedAt: null }).where(inArray(block.id, batch));
            if (uuid !== null) yield* db.update(block).set({ uuid }).where(eq(block.id, row.id));
            yield* blockProjection.forgetVocabulary(batch);
            if (before !== null) yield* closeVocabulary(row.projectId, before, yield* vocabulary.of(row.projectId), null);
            yield* act.record('restore', row.id, { ids: batch });
            const settled = yield* blockRows.rawBlockById(row.id);
            return yield* blockRows.recordOf(settled);
          }),
        );
      });

      return Trash.of({
        delete: Effect.fn('Trash.delete')(function* (input: { id: number }) {
          return yield* trashed(input);
        }),
        depart: Effect.fn('Trash.depart')(function* (input: { id: number; to: GraphAddress }) {
          return yield* departed(input);
        }),

        restore: Effect.fn('Trash.restore')(function* (input: { id: number }) {
          return yield* restored(input, null);
        }),
        reclaim: Effect.fn('Trash.reclaim')(function* (input: { id: number; uuid: string }) {
          return yield* restored(input, input.uuid);
        }),

        roots: reads(
          Effect.fn('Trash.roots')(function* (projectId?: number, among?: readonly number[]) {
            if (among?.length === 0) return [];
            const conditions = [
              sql`${block.deletedAt} is not null`,
              sql`not exists (select 1 from ${block} parent where parent.id = ${block.parentId} and parent.deleted_at is not null)`,
            ];
            if (projectId !== undefined) conditions.push(eq(block.projectId, projectId));
            if (among !== undefined) conditions.push(sql`(${inArray(block.id, [...among])} or ${inArray(block.parentId, [...among])})`);
            const rows = yield* db
              .select()
              .from(block)
              .where(and(...conditions))
              .orderBy(sql`${block.deletedAt} desc`);
            return yield* blockRows.details(rows);
          }),
        ),
      });
    }),
  );
