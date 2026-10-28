import { Clock, Effect } from 'effect';
import { type SourceInput } from '../../contract/wire/sources.js';
import { type AmendmentOp } from '../../contract/wire/batch.js';
import { eq } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { block } from '../../store/tables.js';
import { type AmendmentPayloadRefusal, type BlockCreateRefusal, Blocks } from '../../contract/service/blocks.js';
import { type FloorRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { Act, BlockNames, BlockProjection } from '../../contract/service/acts.js';
import { BlockRows } from '../../acts/rows.js';
import { type BlockRecord, type BlockWrite } from '../../contract/service/acts.js';
import { tagLabel } from '../../contract/wire/tags/roles.js';
import { AMENDMENT, amendmentOf } from '../../contract/wire/tags/amendment.js';
import { Tags } from '../../contract/service/vocabulary.js';
import { blockName } from '../../contract/wire/references.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { projecting } from '../../store/actWrites.js';
import { amendmentField, payloadGate } from './payload.js';

const revising = writes('Review.revise', [block], projecting);

type ReviseRefusal = FloorRefusal | 'not-found' | 'deleted' | 'not-an-amendment' | 'verdict-standing' | AmendmentPayloadRefusal;

export const proposalFiling = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const blockProjection = yield* BlockProjection;
  const blocks = yield* Blocks;
  const vocabulary = yield* Tags;
  const payload = yield* payloadGate;

  const revise = Effect.fn('Review.revise')(function* (input: {
    id: number;
    ops: readonly AmendmentOp[];
  }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<ReviseRefusal>> {
    const current = yield* blockRows.blockById(input.id);
    const table = yield* vocabulary.of(current.projectId);
    if (!table.supports(current, AMENDMENT)) {
      return yield* new GateRefusal(
        'not-an-amendment',
        `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, which does not support the amendment contract; deferred ops belong to an amendment`,
        [`update_block on ${yield* blockNames.nameOf(input.id)} — the block's own text`],
      );
    }
    const target = yield* payload.assertRevised(table, current, input.ops);
    return yield* act.unit(
      revising,
      Effect.gen(function* () {
        const fresh = yield* blockRows.blockById(input.id);
        if (JSON.stringify(fresh.tags) !== JSON.stringify(current.tags) || JSON.stringify(fresh.fields) !== JSON.stringify(current.fields))
          return yield* revise(input);
        const now = new Date(yield* Clock.currentTimeMillis);
        const row = yield* db
          .update(block)
          .set({ fields: { ...fresh.fields, [amendmentField(table, fresh) ?? 'ops']: input.ops }, updatedAt: now })
          .where(eq(block.id, input.id))
          .returning()
          .get();
        if (!row) return yield* Effect.die('proposal revise returned no row');
        yield* blockProjection.syncTags(row.id);
        yield* act.record('revise', row.id, { amends: target.id, ops: input.ops.length }, now);
        return yield* blockRows.recordOf(row);
      }),
    );
  });

  return {
    assertAmendment: payload.assertAmendment,
    amendsEdgeOf: payload.amendsEdgeOf,
    propose: Effect.fn('Review.propose')(function* (input: {
      projectId: number;
      amendsId: number;
      title: string;
      body?: string;
      ops: readonly AmendmentOp[];
      sources?: readonly SourceInput[];
      parentId?: number;
    }): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<BlockCreateRefusal>> {
      const table = yield* vocabulary.of(input.projectId);
      const filed = yield* table.creationType(AMENDMENT);
      const binding = amendmentOf(filed);
      if (binding === null) return yield* Effect.die(`type ${filed.id} supports ${AMENDMENT} without its binding`);
      return yield* blocks.create({
        projectId: input.projectId,
        tags: [filed.id],
        title: input.title,
        body: input.body,
        amendsId: input.amendsId,
        parentId: input.parentId,
        fields: { [binding.ops]: [...input.ops] },
        sources: input.sources === undefined ? undefined : [...input.sources],
      });
    }),

    revise,
  };
});

export type ProposalFiling = Effect.Success<typeof proposalFiling>;
