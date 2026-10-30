import { BLOCK_READ_PAIRS, BLOCK_WRITE_PAIRS } from './blocks.js';
import { SOURCE_PAIRS, SOURCE_READ_PAIRS } from './sources.js';
import { ORIENTATION_PAIRS } from './orientation.js';
import { SESSION_ORIENTATION_PAIRS } from './sessionOrientation.js';
import { OWNER_PAIRS, TREE_PAIRS } from './projects.js';
import { OUTLINE_PAIRS } from './outline.js';
import { HISTORY_PAIRS } from './history.js';
import { REGISTRY_PAIRS } from './registry.js';
import { GROUP_PAIRS } from './groups.js';
import { REFLECTION_PAIRS, WORK_PAIRS, WORK_READ_PAIRS } from './work.js';

import { Effect } from 'effect';
import type { OperationPair } from '../../platform/contract/service/body.js';
import { writtenAt } from './answers.js';

const writtenPairs = <const Pairs extends Readonly<Record<string, OperationPair>>>(pairs: Pairs): Pairs =>
  Object.fromEntries(
    Object.entries(pairs).map(([name, pair]) => [
      name,
      pair.declaration.effect !== 'write'
        ? pair
        : {
            ...pair,
            body: {
              ...pair.body,
              execute: (...args: Parameters<typeof pair.body.execute>) => Effect.flatMap(pair.body.execute(...args), writtenAt),
            },
          },
    ]),
  ) as Pairs;

export const GRAPH_PAIRS: Readonly<Record<string, OperationPair>> = {
  ...ORIENTATION_PAIRS,
  ...SESSION_ORIENTATION_PAIRS,
  ...REGISTRY_PAIRS,
  ...GROUP_PAIRS,
  ...writtenPairs({
    ...BLOCK_READ_PAIRS,
    ...WORK_READ_PAIRS,
    ...SOURCE_READ_PAIRS,
    ...OWNER_PAIRS,
    ...SOURCE_PAIRS,
    ...BLOCK_WRITE_PAIRS,
    ...WORK_PAIRS,
    ...REFLECTION_PAIRS,
    ...TREE_PAIRS,
    ...OUTLINE_PAIRS,
    ...HISTORY_PAIRS,
  }),
};
