import { nextRequestWarmth, type ThreadCacheWarmthInput } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { billing, type ServedModels } from '$lib/features/providers/served.js';
import { tokensWord } from './compactionWords.js';

export type ColdBasis = {
  readonly reading: ThreadCacheWarmthInput['reading'];
  readonly warm: boolean;
  readonly account: string | null;
  readonly compacting: boolean;
};

type ColdPick = {
  readonly provider: string;
  readonly model: string;
  readonly rung: string | null;
};

const PAID: Record<NonNullable<ReturnType<typeof billing>>, string> = {
  'API key': 'billed per token',
  plan: 'on the plan quota',
};

export function coldWords(models: ServedModels, basis: ColdBasis, pick: ColdPick, now: number): string | null {
  if (!basis.warm || basis.reading === null) return null;
  const next = nextRequestWarmth({
    reading: basis.reading,
    next: { provider: pick.provider, model: pick.model, reasoning: pick.rung, account: basis.account },
    models,
    curve: null,
    now,
  });
  const lost = next.invalidatedBy === 'selection' || next.invalidatedBy === 'account' || next.invalidatedBy === 'reasoning';
  if (!lost || next.heldTokens === null || next.heldTokens <= 0) return null;
  const read = basis.compacting ? 'reads the compacted context cold' : `reads ${tokensWord(next.heldTokens)} cold`;
  const billed = billing(models, pick.provider);
  return billed === null ? read : `${read}, ${PAID[billed]}`;
}
