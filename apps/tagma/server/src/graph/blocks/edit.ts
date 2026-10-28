import { Effect } from 'effect';
import { type BlockEdit, type BlockEditRefusal, Blocks } from '../contract/service/blocks.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { WriterRegister, SignedCall } from '../../platform/contract/service/writers.js';
import { event } from '../store/tables.js';
import { Act, type BlockWrite } from '../contract/service/acts.js';
import { blockName } from '../contract/wire/references.js';
import { transactionUnit } from '../acts/state.js';
import { BlockRows } from '../acts/rows.js';
import { writes } from '../../platform/contract/service/writes.js';

const editing = writes('Blocks.edit', []);

export const blockEdit = Effect.fnUntraced(function* (update: Blocks['Service']['update']) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockRows = yield* BlockRows;
  const sessions = yield* WriterRegister;

  return Effect.fn('Blocks.edit')(function* (input: BlockEdit): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<BlockEditRefusal>> {
    const observed = yield* blockRows.blockById(input.id);
    return yield* act.unit(
      editing,
      Effect.gen(function* () {
        const current = yield* blockRows.blockById(input.id);
        if (input.old === '') {
          return yield* new GateRefusal('anchor-empty', 'an edit names the text it replaces', [
            'edit_block — name the exact text to replace, and what replaces it',
            'to write a body from nothing, use update_block with the whole body',
          ]);
        }
        if (input.old === input.new) {
          return yield* new GateRefusal('anchor-noop', 'the anchor and its replacement are the same text', [
            'write what the text should become; an edit that changes nothing is already done',
          ]);
        }
        const occurrences = current.body.split(input.old).length - 1;
        if (occurrences === 0 && current.title.includes(input.old)) {
          return yield* new GateRefusal(
            'anchor-not-found',
            `the text stands in the title of ${blockName(current.uuid)}, and an anchored edit rewrites the body alone`,
            [`update_block on ${blockName(current.uuid)} with the whole new title — in a batch, an \`update\` op with \`title\``],
          );
        }
        if (occurrences === 0) {
          const ownCall = yield* SignedCall;
          const sessionId = ownCall === null || current.body === observed.body ? null : yield* sessions.signedId(yield* transactionUnit);
          const changedBy =
            sessionId === null
              ? undefined
              : yield* db
                  .select({ callId: event.callId })
                  .from(event)
                  .where(
                    and(
                      eq(event.blockId, input.id),
                      eq(event.sessionId, sessionId),
                      eq(event.op, 'update'),
                      sql`json_extract(${event.payload}, '$.delta') is not null`,
                    ),
                  )
                  .orderBy(desc(event.id))
                  .limit(1)
                  .get();
          const sibling = changedBy?.callId !== null && changedBy?.callId !== ownCall ? changedBy?.callId : undefined;
          return yield* new GateRefusal(
            'anchor-not-found',
            sibling === undefined
              ? `${blockName(current.uuid)} has no such text`
              : `${blockName(current.uuid)} has no such text: sibling call ${sibling} changed the body while this call waited to write`,
            sibling === undefined
              ? [
                  `read_block on ${blockName(current.uuid)} — the body as it is stored`,
                  'the anchor matches exact bytes, indentation and line breaks included',
                  'the block may have changed since this anchor was read',
                ]
              : [
                  `sibling call ${sibling} already changed this anchor; keep that result or compose a new edit from the stored body`,
                  `read_block on ${blockName(current.uuid)} — the body after that call`,
                ],
          );
        }
        if (occurrences > 1 && input.all !== true) {
          return yield* new GateRefusal('anchor-ambiguous', `the anchor appears ${occurrences} times in ${blockName(current.uuid)}`, [
            'widen the anchor with surrounding text until it is unique',
            'or replace every occurrence: `replaceAll` on edit_block, `all` on a batch edit',
          ]);
        }
        const next = input.all ? current.body.replaceAll(input.old, () => input.new) : current.body.replace(input.old, () => input.new);
        return yield* update({ id: input.id, body: next });
      }),
    );
  });
});
