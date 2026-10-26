import { ownSummarizer, type ResolvedSummarizer, type ThreadSummarizerSelection } from '@runlith/agent/thread/compaction/summarizer';
import type { TransportCapabilities } from '@runlith/agent/thread/record';
import { type ModelCatalog, reasoningForModel } from '@runlith/llm/models/catalog';
import type { QuotaTable } from '../../providers/contract/wire/accounts.js';
import type { Spendability } from '../../providers/contract/service/quota.js';
import type { ProviderCatalog } from '../../providers/contract/service/registry.js';
import { callable, spendability, textModelOf } from '../models/spendability.js';

export type SummaryFold = 'session' | 'core';

export type SummarizedThread = {
  readonly provider: string;
  readonly model: string;
  readonly account: string | null;
  readonly compaction: TransportCapabilities['compaction'];
};

export type SummarizerSpend =
  | { readonly spendable: true; readonly account: string | null }
  | Extract<Spendability, { readonly spendable: false }>;

export function foldOf(thread: SummarizedThread, selection: ThreadSummarizerSelection): SummaryFold {
  return thread.compaction === 'session' && ownSummarizer(thread, selection) ? 'session' : 'core';
}

export function summarizerSpend(
  catalog: ProviderCatalog,
  thread: SummarizedThread,
  selection: ThreadSummarizerSelection,
  table: QuotaTable,
  now: number,
): SummarizerSpend {
  if (thread.compaction === 'foreign' && selection.provider === thread.provider) return { spendable: false, reason: 'not-callable' };
  if (foldOf(thread, selection) === 'session') return { spendable: true, account: thread.account };
  const account = ownSummarizer(thread, selection) ? thread.account : null;
  return spendability(catalog, selection.provider, selection.model, table, now, account);
}

export function admitSummarizer(
  models: ModelCatalog,
  thread: SummarizedThread,
  named: ThreadSummarizerSelection,
): ResolvedSummarizer | null {
  if (thread.compaction === 'foreign' && named.provider === thread.provider) return null;
  const option = textModelOf(models, named.provider, named.model);
  const rung = option === undefined ? (named.reasoning ?? null) : reasoningForModel(named.reasoning, option) || null;
  if (foldOf(thread, named) === 'session') return { provider: named.provider, model: named.model, reasoning: rung };
  if (option === undefined || !callable(models, named.provider)) return null;
  return { provider: named.provider, model: named.model, reasoning: rung };
}
