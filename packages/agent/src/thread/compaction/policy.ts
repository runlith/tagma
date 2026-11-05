import type { ModelCapacity, ModelCompactionTrigger } from '@runlith/llm/models/description';
import type { RunBudget } from '../agents/AgentProfile';

export type ThreadCompactionPolicy = {
  readonly runBudget?: RunBudget;
  readonly bufferTokens: number;
  readonly imageTokens: number;
  readonly maxRecentTokens: number;
  readonly minRecentTokens: number;
  readonly maxOpeningTokens: number;
  readonly recentFraction: number;
  readonly recentUserTurns: number;
  readonly toolPruneProtectShare: number;
  readonly compactionTrigger: ModelCompactionTrigger;
  readonly compactionOverrides: readonly ThreadCompactionTriggerOverride[];
};

export type ThreadCompactionTriggerOverride = ModelCompactionTrigger & {
  readonly provider: string;
  readonly model: string;
};

export type CompactionTriggerSource = 'override' | 'row' | 'global';

export type ThreadCompactionTriggerStrategy = ModelCompactionTrigger['strategy'];

export type ResolvedCompactionTrigger = ModelCompactionTrigger & {
  readonly source: CompactionTriggerSource;
};

export function resolveCompactionTrigger(input: {
  provider: string;
  model: string | null | undefined;
  policy: ThreadCompactionPolicy;
  row?: ModelCompactionTrigger | undefined;
}): ResolvedCompactionTrigger {
  const model = input.model ?? null;
  const configured = input.policy.compactionOverrides.findLast((entry) => entry.provider === input.provider && entry.model === model);
  if (configured) return { ...triggerFields(configured), source: 'override' };
  if (input.row) return { ...triggerFields(input.row), source: 'row' };
  return { ...triggerFields(input.policy.compactionTrigger), source: 'global' };
}

function triggerFields(trigger: ModelCompactionTrigger): ModelCompactionTrigger {
  return trigger.strategy === 'percent' ? { strategy: 'percent', trigger: trigger.trigger } : { strategy: 'reserve-output' };
}

export function threadUsableTokens(
  capacity: ModelCapacity,
  plannedOutputTokens: number,
  policy: ThreadCompactionPolicy,
  trigger: ModelCompactionTrigger,
): number {
  const planned = Math.min(plannedOutputTokens, capacity.output ?? plannedOutputTokens);
  const inputCeiling = capacity.input === undefined ? null : capacity.input - Math.min(policy.bufferTokens, planned);
  const reserved = Math.max(0, inputCeiling ?? capacity.context - planned);
  if (trigger.strategy === 'reserve-output') return reserved;
  const byShare = Math.floor(trigger.trigger * capacity.context);
  return Math.max(0, inputCeiling === null ? byShare : Math.min(byShare, inputCeiling));
}

export function budgetedCapacity(capacity: ModelCapacity, policy: ThreadCompactionPolicy): ModelCapacity {
  if (policy.runBudget === undefined) return capacity;
  const ceiling = policy.runBudget.prompt ?? capacity.premiumAbove;
  return ceiling === undefined ? capacity : { ...capacity, input: Math.min(capacity.input ?? ceiling, ceiling) };
}

export function threadRequestCapacity(capacity: ModelCapacity): number {
  return capacity.input ?? capacity.context;
}
