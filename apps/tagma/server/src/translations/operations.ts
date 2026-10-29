import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { BlockNames } from '../graph/contract/service/acts.js';
import { Blocks } from '../graph/contract/service/blocks.js';
import { Selection } from '../graph/contract/service/reads.js';
import { blockName, blockRefTargets } from '../graph/contract/wire/references.js';
import { Translations, type Translated } from './contract/service/translations.js';
import { TRANSLATION_OPERATIONS as OPS, type TranslationOperationId } from './contract/wire/operations.js';

const translated = Effect.fnUntraced(function* (name: string) {
  const row = yield* (yield* Blocks).blockById(yield* (yield* BlockNames).idOfName(name));
  return { projectId: row.projectId, uuid: row.uuid, name: blockName(row.uuid), title: row.title, body: row.body } satisfies Translated;
});

export const TRANSLATION_PAIRS: { readonly [K in TranslationOperationId]: OperationPair<(typeof OPS)[K]> } = {
  translate_block: pair(
    OPS.translate_block,
    body(OPS.translate_block, {
      execute: Effect.fnUntraced(function* (input) {
        const block = yield* translated(input.block);
        const started = yield* (yield* Translations).start(block, {
          language: input.language,
          model: input.model,
          reasoning: input.reasoning,
          again: input.again === true,
        });
        return { ...started, block: block.name, language: input.language };
      }),
    }),
  ),
  read_block_translation: pair(
    OPS.read_block_translation,
    body(OPS.read_block_translation, {
      execute: Effect.fnUntraced(function* (input) {
        const block = yield* translated(input.block);
        const references = input.language === undefined ? [] : yield* (yield* Selection).titles(blockRefTargets(block.body));
        const reading = yield* (yield* Translations).read(block, input.language, references);
        return { status: 'read' as const, block: block.name, ...reading };
      }),
    }),
  ),
  stop_block_translation: pair(
    OPS.stop_block_translation,
    body(OPS.stop_block_translation, {
      execute: Effect.fnUntraced(function* (input) {
        const block = yield* translated(input.block);
        const stopped = yield* (yield* Translations).stop(block, input.language);
        return { status: stopped ? ('stopped' as const) : ('idle' as const), block: block.name, language: input.language };
      }),
    }),
  ),
};
