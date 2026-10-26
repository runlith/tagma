import { type ResolvedCompactionTrigger, type ThreadCompactionPolicy, resolveCompactionTrigger } from './policy';
import type { CompactionModels, ServedModel } from './CompactionModels';
import type { ResolvedSummarizer } from './summarizer';

export function modelOf(models: CompactionModels, provider: string, model: string | null, runId?: string): string | null {
  return model ?? models.defaultModel(provider, runId);
}

export function sameDeployment(
  models: CompactionModels,
  identity: { readonly provider: string; readonly model: string | null; readonly runId?: string },
  member: ResolvedSummarizer,
): boolean {
  return member.provider === identity.provider && member.model === modelOf(models, identity.provider, identity.model, identity.runId);
}

export function triggerOf(
  served: ServedModel,
  provider: string,
  model: string | null,
  policy: ThreadCompactionPolicy,
): ResolvedCompactionTrigger {
  return resolveCompactionTrigger({ provider, model, policy, row: served.compactionTrigger });
}

export const signed = (account: string | undefined): { readonly account?: string } => (account === undefined ? {} : { account });
