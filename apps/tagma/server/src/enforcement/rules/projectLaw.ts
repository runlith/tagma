import { Effect } from 'effect';
import type { LawReading } from '../../graph/contract/service/law.js';
import { describedBy, mapRefusalOf } from '../contract/wire/document.js';
import { descriptionsAt } from './descriptions.js';
import { placeOf } from './measure.js';
import { assembleMap } from './moduleMap.js';

export const lawReading = Effect.fn('enforcement.lawReading')(function* (at: { readonly projectId: number; readonly root: string }) {
  const { head, commonDir } = yield* placeOf(at.root);
  const descriptions = yield* descriptionsAt({
    projectId: at.projectId,
    actor: { _tag: 'Operator' },
    root: at.root,
    tree: head,
    commonDir,
  });
  const reading: LawReading = {
    undeclared: (key) => {
      const described = describedBy(descriptions, key);
      return typeof described === 'string' ? described : null;
    },
    mapProblems: (keys, cards) => {
      const map = assembleMap(cards);
      return [...new Set(keys)].flatMap((key) => {
        const described = describedBy(descriptions, key);
        if (typeof described === 'string' || !('builtin' in described)) return [];
        const problem = mapRefusalOf(described, map);
        return problem === undefined ? [] : [{ key, problem }];
      });
    },
  };
  return reading;
});
