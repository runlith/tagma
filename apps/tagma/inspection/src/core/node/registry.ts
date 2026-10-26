import type { Pack, Rule } from '../rule';
import type { Implementation, ImplementationsOf } from './reading';

export class RuleNotReady extends Error {
  constructor(readonly id: string) {
    super(`the rule ${id} is not ready: no pack holding it was loaded in this process`);
    this.name = 'RuleNotReady';
  }
}

type Held = { readonly pack: string; readonly rule: Rule<unknown>; readonly implementation: Implementation<unknown> };

const held = new Map<string, Held>();

const refusalOf = (pack: Pack, byId: Readonly<Record<string, Implementation<unknown> | undefined>>): string | undefined => {
  const extra = Object.keys(byId).find((id) => !pack.rules.some((rule) => rule.id === id));
  if (extra !== undefined) return `the pack ${pack.id} has a reading for ${extra}, which it does not declare`;
  for (const rule of pack.rules) {
    const implementation = byId[rule.id];
    if (implementation === undefined) return `the pack ${pack.id} declares ${rule.id} and has no reading for it`;
    const owner = held.get(rule.id)?.pack;
    if (owner !== undefined && owner !== pack.id) return `the rule ${rule.id} is registered by both ${owner} and ${pack.id}`;
    if ((rule.sliced === true) !== (implementation.slices !== undefined))
      return `the rule ${rule.id} must declare \`sliced\` exactly when its reading has \`slices\``;
  }
  return undefined;
};

export const register = <P extends Pack>(pack: P, implementations: ImplementationsOf<P>): void => {
  const byId = implementations as unknown as Readonly<Record<string, Implementation<unknown> | undefined>>;
  const refusal = refusalOf(pack, byId);
  if (refusal !== undefined) throw new Error(refusal);
  for (const rule of pack.rules)
    held.set(rule.id, { pack: pack.id, rule: rule as unknown as Rule<unknown>, implementation: byId[rule.id] as Implementation<unknown> });
};

const heldOf = (id: string): Held => {
  const found = held.get(id);
  if (found === undefined) throw new RuleNotReady(id);
  return found;
};

export const ruleOf = (id: string): Rule<unknown> => heldOf(id).rule;

export const implementationOf = (id: string): Implementation<unknown> => heldOf(id).implementation;
