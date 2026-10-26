import { Effect } from 'effect';
import type { StartPricing } from '../../platform/contract/service/start.js';
import type { ContractId } from '../contract/wire/tags/behaviour.js';
import { Tags } from '../contract/service/vocabulary.js';
import { lawShapingTypes } from '../store/lawRevision.js';

export const lawPricing = (projectId: number, quiet = false): StartPricing => ({ projectId, moves: 'law', quiet });

export const nodePricing = Effect.fn('start.node')(function* (
  projectId: number,
  node: { readonly tags: readonly string[] },
  quiet = false,
) {
  const table = yield* (yield* Tags).of(projectId);
  const shaping = new Set(lawShapingTypes(table));
  const keys = node.tags.map((word) => table.identities.keyOf(word) ?? word);
  return table.tagsOf({ tags: keys }).some((tag) => shaping.has(tag.id)) ? lawPricing(projectId, quiet) : null;
});

export const birthPricing = Effect.fn('start.birth')(function* (
  projectId: number,
  tags: readonly string[] | undefined,
  contract: ContractId | undefined,
) {
  if (tags !== undefined || contract === undefined) return yield* nodePricing(projectId, { tags: tags ?? [] });
  const table = yield* (yield* Tags).of(projectId);
  return yield* nodePricing(projectId, { tags: [(yield* table.creationType(contract)).id] });
});
