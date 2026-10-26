import { Effect, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { type PhaseWords, phaseWordsSchema } from '../contract/wire/far.js';
import { phaseWordsKey } from '../contract/wire/storage.js';
import { meta } from '../store/tables.js';
import { vocabularyRevision } from '../store/lawRevision.js';

const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(phaseWordsSchema));

export const publishPhaseWords = Effect.fn('Vocabulary.publishPhaseWords')(function* (
  db: StoreDb<'graph'>,
  table: TagTable,
  projectId: number,
) {
  const words: PhaseWords = {
    revision: yield* vocabularyRevision(db, projectId),
    contracts: Object.fromEntries(
      table.contracts.map((contract) => [
        contract,
        {
          initial: table.wordsAt(contract, 'initial'),
          active: table.wordsAt(contract, 'active'),
          terminal: table.wordsAt(contract, 'terminal'),
        },
      ]),
    ),
  };
  const value = JSON.stringify(words);
  yield* db
    .insert(meta)
    .values({ key: phaseWordsKey(projectId), value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
});

export const phaseWordsStand = Effect.fn('Vocabulary.phaseWordsStand')(function* (db: StoreDb<'graph'>, projectId: number) {
  const row = yield* db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, phaseWordsKey(projectId)))
    .get();
  if (row === undefined) return false;
  const words = decoded(row.value);
  return words._tag === 'Some' && words.value.revision === (yield* vocabularyRevision(db, projectId));
});
