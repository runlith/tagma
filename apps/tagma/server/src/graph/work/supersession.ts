import { Clock, Effect, Layer } from 'effect';
import { and, eq } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, edge, touch } from '../store/tables.js';
import { type FloorRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Act, BlockNames, BlockProjection } from '../contract/service/acts.js';
import { Touches } from '../contract/service/orientation.js';
import { movedFields } from './movedFields.js';
import { releasedStatus, statusMove } from '../contract/wire/tags/roles.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { BlockRows } from '../acts/rows.js';
import { type BlockWrite } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { Supersession } from '../contract/service/work.js';
import { writes } from '../../platform/contract/service/writes.js';
import { linking, projecting } from '../store/actWrites.js';
import { HOLDER } from '../contract/wire/tags/holder.js';
import { assertNoBoundary } from '../blocks/guards.js';

const superseding = writes('Standing.supersede', [block, touch], linking, projecting);
const unsuperseding = writes('Standing.unsupersede', [block, edge]);

type SupersedeRefusal =
  | FloorRefusal
  | 'not-found'
  | 'deleted'
  | 'self-supersede'
  | 'cross-project'
  | 'already-superseded'
  | 'operation-only'
  | 'successor-superseded'
  | 'field-invalid';

type UnsupersedeRefusal = FloorRefusal | 'not-found' | 'deleted' | 'not-superseded';

export const supersessionLayer: Layer.Layer<
  Supersession,
  never,
  GraphStore | Act | Tags | BlockRows | BlockNames | BlockProjection | Touches
> = Layer.effect(
  Supersession,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const act = yield* Act;
    const blockRows = yield* BlockRows;
    const blockNames = yield* BlockNames;
    const blockProjection = yield* BlockProjection;
    const touches = yield* Touches;
    const vocabulary = yield* Tags;

    return Supersession.of({
      supersede: Effect.fn('Standing.supersede')(function* (input: {
        oldId: number;
        withId: number;
      }): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<SupersedeRefusal>> {
        if (input.oldId === input.withId) {
          return yield* new GateRefusal('self-supersede', 'a block does not supersede itself', [
            `write the successor first, then supersede_block naming ${input.oldId} and it`,
            `rewriting this block in place is edit_block ${input.oldId} — no successor, no chain`,
          ]);
        }
        const old = yield* blockRows.blockById(input.oldId);
        const oldTable = yield* vocabulary.of(old.projectId);
        const replacement = yield* blockRows.blockById(input.withId);
        if (replacement.projectId !== old.projectId) {
          return yield* new GateRefusal('cross-project', 'a block is superseded by a block of the same project', [
            `write the successor in project ${old.projectId}, beside what it replaces`,
          ]);
        }
        if (yield* blockRows.isSuperseded(input.oldId)) {
          return yield* new GateRefusal('already-superseded', `${yield* blockNames.nameOf(input.oldId)} was already replaced`, [
            `read_block ${yield* blockNames.nameOf(input.oldId)} — the edge names its successor`,
          ]);
        }
        if (yield* blockRows.isSuperseded(input.withId)) {
          return yield* new GateRefusal(
            'successor-superseded',
            `${yield* blockNames.nameOf(input.withId)} was itself replaced, so it cannot take another block's place`,
            [
              `read_block ${yield* blockNames.nameOf(input.withId)} — the edge names what replaced it`,
              'name the block that stands at the head of that chain',
            ],
          );
        }
        return yield* act.unit(
          superseding,
          Effect.gen(function* () {
            const replaced = yield* blockRows.blockById(input.oldId);
            yield* assertNoBoundary(oldTable, [replaced], 'superseded');
            const now = new Date(yield* Clock.currentTimeMillis);
            const lifecycle = oldTable.bindingTag(replaced, LIFECYCLE);
            const released = lifecycle !== null && oldTable.standsAt(replaced, HOLDER, 'active') ? releasedStatus(lifecycle) : null;
            const row = yield* db
              .update(block)
              .set({ updatedAt: now, fields: released === null ? undefined : movedFields(oldTable, replaced, released, null) })
              .where(eq(block.id, input.oldId))
              .returning()
              .get();
            if (!row) return yield* Effect.die('block supersede returned no row');
            if (lifecycle !== null && released !== null) {
              yield* blockProjection.syncTags(row.id);
              yield* touches.retire(row.id);
              yield* act.record('release', row.id, statusMove(lifecycle, oldTable.statusOf(replaced), released) ?? {}, now);
            }
            if (!(yield* blockRows.insertEdgeRow(input.withId, 'supersedes', input.oldId))) {
              return yield* new GateRefusal(
                'already-superseded',
                `${yield* blockNames.nameOf(input.oldId)} was replaced while this act ran`,
                [`read_block ${yield* blockNames.nameOf(input.oldId)} — the edge names its successor`],
              );
            }
            yield* act.record('supersede', input.oldId, { withId: input.withId }, now);
            return yield* blockRows.written(row, true);
          }),
        );
      }),

      unsupersede: Effect.fn('Standing.unsupersede')(function* (input: {
        id: number;
      }): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<UnsupersedeRefusal>> {
        const row = yield* blockRows.blockById(input.id);
        const successor = yield* blockRows.successorOf(input.id);
        if (successor === null) {
          return yield* new GateRefusal(
            'not-superseded',
            `${blockName(row.uuid)} was not replaced, so there is no retirement to withdraw`,
            [
              `read_block ${blockName(row.uuid)} — a replaced block names the successor that took its place`,
              'a block that became right again is corrected on the block that STANDS, or replaced by a new one — this act is for a replacement written by mistake',
            ],
          );
        }
        return yield* act.unit(
          unsuperseding,
          Effect.gen(function* () {
            const now = new Date(yield* Clock.currentTimeMillis);
            yield* db.delete(edge).where(and(eq(edge.fromId, successor), eq(edge.kind, 'supersedes'), eq(edge.toId, input.id)));
            const updated = yield* db.update(block).set({ updatedAt: now }).where(eq(block.id, input.id)).returning().get();
            if (!updated) return yield* Effect.die('block unsupersede returned no row');
            yield* act.record('unsupersede', input.id, { withId: successor }, now);
            return yield* blockRows.written(updated, true);
          }),
        );
      }),

      isSuperseded: (id) => blockRows.isSuperseded(id),
      supersedesReaches: (from, to) => blockRows.supersedesReaches(from, to),
      successorOf: (id) => blockRows.successorOf(id),
    });
  }),
);
