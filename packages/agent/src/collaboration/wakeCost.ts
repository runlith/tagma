import type { AgentSignalContext, ThreadModelChoice, WakeCost } from '../agent/contracts';
import { clockFigure, tokensFigure } from '../agent/figures';
import type { ThreadCacheWarmth } from '../thread/cache/ThreadCacheWarmth';

export type ColdRecipient = { readonly threadId: string; readonly name: string | null; readonly tokens: number };

export type ColdWakeRule = { readonly refuse: boolean; readonly tokens: number };

export const COLD_WAKE_RULE: ColdWakeRule = { refuse: true, tokens: 100_000 };

const NOTHING_KNOWN: WakeCost = { kind: 'unknown', tokens: null };

export function wakeCostOf(warmth: ThreadCacheWarmth | null): WakeCost {
  if (warmth === null || warmth.invalidatedBy === 'compaction' || warmth.invalidatedBy === 'rewind') return NOTHING_KNOWN;
  const tokens = warmth.heldTokens;
  if (warmth.invalidatedBy !== null) return { kind: 'cold', tokens };
  if (warmth.basis === 'promise' && warmth.expiresAt !== null) {
    return warmth.state === 'warm' ? { kind: 'warm', tokens, until: warmth.expiresAt } : { kind: 'cold', tokens };
  }
  if (warmth.basis === 'local' || warmth.basis === 'prior') {
    return { kind: warmth.state === 'cold' ? 'estimated-cold' : 'likely-warm', tokens };
  }
  return { kind: 'unknown', tokens };
}

export function coldTokens(cost: WakeCost, rule: ColdWakeRule): number | null {
  return cost.kind === 'cold' && cost.tokens !== null && cost.tokens >= rule.tokens ? cost.tokens : null;
}

export function wakeWords(cost: WakeCost): string | undefined {
  const size = cost.tokens === null ? undefined : tokensFigure(cost.tokens);
  const joined = (word: string) => (size === undefined ? word : `${word} · ${size}`);
  switch (cost.kind) {
    case 'warm':
      return joined(`warm until ${clockFigure(cost.until)}`);
    case 'cold':
      return size === undefined ? 'cold' : `cold · ${size} rewritten`;
    case 'likely-warm':
      return joined('likely warm');
    case 'estimated-cold':
      return joined('estimated cold');
    case 'unknown':
      return size;
  }
}

export function envelopeContextOf(cost: WakeCost): AgentSignalContext | undefined {
  if (cost.tokens === null) return undefined;
  return cost.kind === 'warm' ? { tokens: cost.tokens, warmUntil: cost.until } : { tokens: cost.tokens };
}

export function cooledLine(child: string, tokens: number | null): string {
  return tokens === null ? `${child} cooled` : `${child} cooled · ${tokensFigure(tokens)} to rewrite`;
}

export function compactedLine(child: string, tokens: number | null): string {
  return tokens === null ? `${child} compacted` : `${child} compacted · context ${tokensFigure(tokens)}`;
}

export function ranLine(child: string, cost: WakeCost, forOperator: boolean): string {
  const warmth =
    cost.kind === 'warm'
      ? `warm until ${clockFigure(cost.until)}`
      : cost.kind === 'unknown'
        ? null
        : cost.kind === 'likely-warm'
          ? 'likely warm'
          : cost.kind === 'estimated-cold'
            ? 'estimated cold'
            : 'cold';
  return [
    `${child} ran`,
    ...(cost.tokens === null ? [] : [`context ${tokensFigure(cost.tokens)}`]),
    ...(warmth === null ? [] : [warmth]),
    ...(forOperator ? ['for the operator'] : []),
  ].join(' · ');
}

function modelWords(choice: ThreadModelChoice): string {
  return `${choice.provider}/${choice.model ?? 'default'} ${choice.reasoning ?? 'default'}`;
}

export function modelChangedLine(child: string, from: ThreadModelChoice, to: ThreadModelChoice): string {
  return `${child} model changed · ${modelWords(from)} → ${modelWords(to)}`;
}

export function coldReason(cold: readonly ColdRecipient[]): string {
  const named = cold.map(
    (recipient) => `${recipient.name ?? recipient.threadId} is cold: waking it rewrites ${tokensFigure(recipient.tokens)}`,
  );
  return `${named.join('; ')}. Nothing was sent.`;
}
