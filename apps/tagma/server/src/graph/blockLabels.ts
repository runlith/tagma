import { Effect } from 'effect';
import { Blocks } from './contract/service/blocks.js';
import { Tags } from './contract/service/vocabulary.js';
import { blockName } from './contract/wire/references.js';
import { WORK } from './contract/wire/tags/work.js';
import { cross } from './operations/crossing.js';

type BlockLabel = { readonly name: string; readonly title: string; readonly stealth: boolean; readonly work: boolean };

export const blockLabel = (name: string) =>
  cross(name, (id) =>
    Effect.gen(function* () {
      const row = yield* (yield* Blocks).blockById(id);
      const table = yield* (yield* Tags).of(row.projectId);
      return { name: blockName(row.uuid), title: row.title, stealth: row.stealth, work: table.supports(row, WORK) } satisfies BlockLabel;
    }),
  );
