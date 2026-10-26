import type { Unblock } from '../../platform/contract/wire/refusal.js';
import type { BehaviourRegistry } from '../contract/service/behaviours.js';
import type { Catalogs } from '../contract/wire/catalogs.js';
import type { ContractId } from '../contract/wire/tags/behaviour.js';
import { shippedTypeId } from '../contract/wire/tags/identity.js';
import { compileVocabulary } from './compiler.js';

export function catalogUnblock(catalogs: Catalogs['Service'], behaviours: BehaviourRegistry, contract: ContractId): Unblock {
  const ids = catalogs.all.flatMap((catalog) => {
    const keys = new Map(
      catalog.tags.flatMap((tag) => [
        [tag.id, tag.id],
        [shippedTypeId(catalog.id, tag.id), tag.id],
      ]),
    );
    const outcomes = compileVocabulary(
      catalog.tags.map((declaration) => ({ name: `#${declaration.id}`, declaration, unread: null })),
      behaviours,
      (word) => keys.get(word) ?? null,
    );
    return outcomes.some((outcome) => outcome.kind === 'compiled' && outcome.compiled.tag.contracts?.[contract] !== undefined)
      ? [catalog.id]
      : [];
  });
  return ids.length === 0 ? [`declare a type supporting ${contract}`] : [`install a catalog carrying ${contract}: ${ids.join(', ')}`];
}
