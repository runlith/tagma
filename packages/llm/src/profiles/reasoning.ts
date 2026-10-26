import { type ReasoningEffort, ReasoningEfforts } from '../llm/schema/ids';

export function reasoningRung(value: string | null | undefined): ReasoningEffort | undefined {
  return ReasoningEfforts.includes(value as ReasoningEffort) ? (value as ReasoningEffort) : undefined;
}

const THINKING_FRACTION: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 0.0625,
  low: 0.125,
  medium: 0.25,
  high: 0.5,
  xhigh: 0.75,
  max: 0.9,
};

const MINIMUM_THINKING_BUDGET = 1024;

export function thinkingBudget(rung: ReasoningEffort | undefined, outputTokens: number): number | undefined {
  if (rung === undefined || rung === 'none') return undefined;
  const budget = Math.floor(outputTokens * THINKING_FRACTION[rung]);
  if (budget < MINIMUM_THINKING_BUDGET) return undefined;
  return budget;
}
