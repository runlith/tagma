import { holderAt, type NamedHolder } from '../../workspace/contract/wire/checkout.js';
import type { Verdict } from '../lines/projection.js';
import type { HolderLines } from './authored.js';

export const carriesOf = (
  verdict: Verdict | undefined,
  names: ReadonlyMap<string, { readonly name: string | null }>,
): readonly HolderLines[] => {
  if (verdict === undefined || verdict.verdict !== 'proven' || verdict.lines === 'unweighed') return [];
  const carries = new Map<string, { readonly holder: NamedHolder; readonly added: Set<number>; readonly removed: Set<number> }>();
  for (const line of verdict.lines) {
    if (line.mark === 'external') continue;
    const key = line.mark.holder;
    const carry = carries.get(key) ?? {
      holder: { holder: holderAt(key), agentName: names.get(key)?.name ?? null },
      added: new Set<number>(),
      removed: new Set<number>(),
    };
    carries.set(key, carry);
    carry[line.kind].add(line.at);
  }
  return [...carries.values()];
};
