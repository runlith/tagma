import type { ModelCatalog, ModelOption } from '@runlith/llm/models/catalog';
import type { QuotaTable, AccountQuotaRow } from '../../providers/contract/wire/accounts.js';
import type { Spendability } from '../../providers/contract/service/quota.js';
import type { ProviderCatalog } from '../../providers/contract/service/registry.js';

export function textModelOf(models: ModelCatalog, provider: string, model: string): ModelOption | undefined {
  return models.registered(provider) ? models.modelsFor(provider, 'text').find((candidate) => candidate.id === model) : undefined;
}

export function callable(models: ModelCatalog, provider: string): boolean {
  return models.registered(provider) && models.named(provider).auth !== 'cli';
}

export function spendability(
  catalog: ProviderCatalog,
  provider: string,
  model: string,
  table: QuotaTable,
  now: number,
  account: string | null = null,
): Spendability {
  const option = textModelOf(catalog.models, provider, model);
  if (option === undefined) return { spendable: false, reason: 'unknown-model' };
  if (!callable(catalog.models, provider)) return { spendable: false, reason: 'not-callable' };
  const rows = signingRows(catalog, provider, table);
  if (rows.length === 0) return { spendable: false, reason: 'not-connected' };
  const row = account === null ? signingRow(rows) : rows.find((candidate) => String(candidate.account) === account);
  if (row === undefined) return { spendable: false, reason: 'no-account' };
  const retryAt = rateLimitedUntil(row);
  if (retryAt !== null && retryAt > now) return { spendable: false, reason: 'rate-limited', until: retryAt };
  const until = quotaUntil(option, row, now);
  if (until !== null) return { spendable: false, reason: 'quota', until };
  return { spendable: true, account: String(row.account) };
}

export type TurnSpendability = Spendability | { readonly spendable: true; readonly account: null };

export function turnSpendability(
  catalog: ProviderCatalog,
  provider: string,
  model: string,
  table: QuotaTable,
  now: number,
  account: string | null = null,
): TurnSpendability {
  const { models } = catalog;
  if (!models.registered(provider) || models.named(provider).auth !== 'cli') {
    return spendability(catalog, provider, model, table, now, account);
  }
  const option = textModelOf(models, provider, model);
  if (option === undefined) return { spendable: false, reason: 'unknown-model' };
  const rows = signingRows(catalog, provider, table);
  const row = account === null ? signingRow(rows) : rows.find((candidate) => String(candidate.account) === account);
  const until = row === undefined ? null : quotaUntil(option, row, now);
  if (until !== null) return { spendable: false, reason: 'quota', until };
  return { spendable: true, account: row === undefined ? account : String(row.account) };
}

function quotaUntil(option: ModelOption, row: AccountQuotaRow, now: number): number | null {
  let until: number | null = null;
  for (const window of row.quota?.windows ?? []) {
    if (!(window.usedPercent >= 100) || window.resetsAt === undefined || !(window.resetsAt * 1_000 > now)) continue;
    if (window.model !== undefined && !names(option, window.model)) continue;
    until = Math.max(until ?? 0, window.resetsAt * 1_000);
  }
  return until;
}

export function signingAccount(catalog: ProviderCatalog, provider: string, table: QuotaTable): string | null {
  const row = signingRow(signingRows(catalog, provider, table));
  return row === undefined ? null : String(row.account);
}

function signingRows(catalog: ProviderCatalog, provider: string, table: QuotaTable): readonly AccountQuotaRow[] {
  const source = catalog.accountSource(provider);
  return table.filter((row) => row.provider === source);
}

function signingRow(rows: readonly AccountQuotaRow[]): AccountQuotaRow | undefined {
  return rows.find((candidate) => candidate.default) ?? (rows.length === 1 ? rows[0] : undefined);
}

function rateLimitedUntil(row: AccountQuotaRow): number | null {
  const failure = row.failure;
  if (failure?._tag !== 'rate-limited' || failure.retryAfterMs === undefined || row.failedAt === null) return null;
  return row.failedAt + failure.retryAfterMs;
}

function names(option: { readonly id: string; readonly label: string }, windowModel: string): boolean {
  const named = windowModel.trim().toLowerCase();
  return option.id.toLowerCase().includes(named) || option.label.toLowerCase().includes(named);
}
