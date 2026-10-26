import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import type { SummarizerRow } from '@tagma/server/native-harness/contract/wire/compactionChoices';
import type { ThreadSummarizerSkipReason } from '@runlith/agent/transcript/entries';
import { accountSourceOf, providerName, type ServedModels } from '../served.js';

const SKIP: Record<ThreadSummarizerSkipReason, string> = {
  'unknown-model': 'not in the catalog',
  'not-callable': 'only its CLI calls it',
  'not-connected': 'not connected',
  'no-account': 'no default account',
  quota: 'no quota',
  'rate-limited': 'rate-limited',
  unavailable: 'unavailable',
  overflow: 'history does not fit',
};

const DAY_MS = 86_400_000;

export function modelLabel(models: ServedModels, provider: string, model: string | null): string {
  if (model === null) return providerName(models, provider);
  return models.modelsFor(provider, 'text').find((option) => option.id === model)?.label ?? model;
}

function clockWord(until: string, now: number): string {
  const at = new Date(until);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (at.getTime() - now < DAY_MS && at.getDate() === new Date(now).getDate()) return time;
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function skipWords(reason: ThreadSummarizerSkipReason, until: string | null | undefined, now: number): string {
  return until == null ? SKIP[reason] : `${SKIP[reason]} until ${clockWord(until, now)}`;
}

export function signedWords(models: ServedModels, account: string, accounts: readonly AccountQuotaRow[]): string {
  const row = accounts.find((candidate) => String(candidate.account) === account);
  return row === undefined ? account : `${providerName(models, row.provider)} · ${row.label}`;
}

export function paysWords(models: ServedModels, pays: SummarizerRow['pays'], accounts: readonly AccountQuotaRow[]): string {
  const source = accountSourceOf(models, pays.provider);
  const label =
    pays.account === null ? undefined : accounts.find((row) => row.provider === source && String(row.account) === pays.account)?.label;
  const vendor = providerName(models, pays.provider);
  return label === undefined ? vendor : `${vendor} · ${label}`;
}

export function spendBasis(accounts: readonly AccountQuotaRow[]): string {
  return accounts
    .map((row) =>
      [
        row.provider,
        String(row.account),
        row.default,
        row.failedAt ?? '',
        (row.quota?.windows ?? [])
          .filter((window) => window.usedPercent >= 100)
          .map((window) => `${window.model ?? ''}@${window.resetsAt ?? ''}`)
          .join(','),
      ].join(':'),
    )
    .join(';');
}
