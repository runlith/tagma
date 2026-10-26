import { Effect } from 'effect';
import type { DoctrineFacts } from '../../platform/contract/service/facts.js';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';
import type { FactCheckout } from '../../platform/contract/wire/section.js';

export type TurnFacts = (checkout: FactCheckout) => Effect.Effect<Readonly<Record<string, boolean>>>;

export const turnFacts = (facts: DoctrineFacts['Service'] | null, sections: SectionCatalog | null): TurnFacts => {
  const ids = [
    ...new Set(Object.values(sections?.sections ?? {}).flatMap((section) => (section.fact === undefined ? [] : [section.fact]))),
  ];
  return (checkout) => (facts === null || ids.length === 0 ? Effect.succeed({}) : facts.read(ids, checkout));
};
