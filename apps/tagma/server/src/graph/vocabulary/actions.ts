import type { BehaviourRegistry } from '../contract/service/behaviours.js';
import type { TagActions, TagMove } from '../contract/wire/tags/actions.js';
import type { ContractBinding, ContractBindings, ContractId } from '../contract/wire/tags/behaviour.js';
import type { Tag } from '../contract/wire/tags/declaration.js';
import { statusesAt } from '../contract/wire/tags/roles.js';

const own = <V>(record: Readonly<Record<string, V>> | undefined, key: string): V | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

export function projectActions(tag: Tag, behaviours: BehaviourRegistry, contracts: ContractBindings = tag.contracts ?? {}): TagActions {
  const moves: TagMove[] = [];
  const slots = new Map<string, string[]>();
  const offers: { readonly contract: ContractId; readonly ops: readonly string[] }[] = [];
  const wordOf = (contract: ContractId, meaning: string): string | undefined => own(own(contracts, contract)?.words, meaning);
  for (const [contract, binding] of Object.entries(contracts) as [ContractId, ContractBinding][]) {
    const behaviour = behaviours.get(contract)?.behaviour;
    if (behaviour === undefined) continue;
    const offered: string[] = [];
    for (const { op, moves: declared = [], writes = [] } of behaviour.actions) {
      if (declared.length === 0 && writes.length === 0) offered.push(op);
      for (const move of declared) {
        const over = move.contract ?? contract;
        const word = wordOf(over, move.to);
        const read = own(behaviours.get(over)?.behaviour.words, move.to);
        const field = read === undefined ? undefined : own(own(contracts, read.contract ?? over)?.slots, read.slot);
        if (word === undefined || field === undefined) continue;
        if ((move.needs ?? []).some((meaning) => wordOf(over, meaning) === undefined)) continue;
        const from = move.from === undefined ? undefined : statusesAt(tag, move.from);
        if (from !== undefined && from.length === 0) continue;
        moves.push({ field, to: word, op, from, says: move.says, label: move.label });
      }
      for (const slot of writes) {
        const field = own(binding.slots, slot);
        if (field === undefined) continue;
        const ops = slots.get(field);
        if (ops === undefined) slots.set(field, [op]);
        else if (!ops.includes(op)) ops.push(op);
      }
    }
    if (offered.length > 0) offers.push({ contract, ops: offered });
  }
  return { moves, slots: [...slots].map(([field, ops]) => ({ field, ops })), offers };
}
