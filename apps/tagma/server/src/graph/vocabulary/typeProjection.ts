import { Effect } from 'effect';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GraphStore } from '../../platform/contract/service/store.js';
import type { Tags } from '../contract/service/vocabulary.js';
import { ActState } from '../contract/service/transaction.js';
import { block, blockTag } from '../store/tables.js';
import { storedTypeId } from './projection.js';
import { advanceLaw, advanceVocabulary } from '../store/lawRevision.js';
import { publishPhaseWords } from './phaseWords.js';

export const projectTypeIds = Effect.fn('BlockProjection.typeIds')(function* (db: GraphStore['Service']['db'], tags: Tags['Service']) {
  const unit = yield* ActState;
  for (const projectId of unit.vocabulary) {
    yield* advanceVocabulary(db, projectId);
    yield* advanceLaw(db, projectId);
    const table = yield* tags.of(projectId);
    yield* publishPhaseWords(db, table, projectId);
    const mine = db.select({ id: block.id }).from(block).where(eq(block.projectId, projectId));
    const carried = yield* db
      .selectDistinct({ tag: blockTag.tag, typeId: blockTag.typeId })
      .from(blockTag)
      .where(inArray(blockTag.blockId, mine));
    const changed = new Map<string, string | null>();
    for (const row of carried) {
      const typeId = storedTypeId(table, row.tag);
      if (typeId !== row.typeId) changed.set(row.tag, typeId);
    }
    for (const [tag, typeId] of changed) {
      yield* db
        .update(blockTag)
        .set({ typeId })
        .where(and(eq(blockTag.tag, tag), inArray(blockTag.blockId, mine), sql`${blockTag.typeId} is not ${typeId}`));
    }
  }
});
