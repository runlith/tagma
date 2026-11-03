import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { expect, test } from 'vitest';
import type { ServedModels } from '../served.js';
import { SHIPPED_SERVED } from '../testing.js';
import { paysWords, spendBasis } from './spendWords.js';

const NOW = Date.parse('2026-09-02T12:00:00Z');
const RESET = (NOW + 3_600_000) / 1000;

function row(usedPercent: number, fields: Partial<AccountQuotaRow> = {}): AccountQuotaRow {
  return {
    provider: 'subscription',
    account: 'k1',
    label: 'work@example.com',
    origin: { kind: 'own' },
    default: true,
    quota: new QuotaObservation({
      observedAt: new Date(NOW),
      source: 'usage',
      windows: [new QuotaWindow({ kind: 'session', usedPercent, resetsAt: RESET })],
    }),
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
    lent: [],
    ...fields,
  } as AccountQuotaRow;
}

test('spending that leaves an account spendable keeps the basis a choice read is keyed on', () => {
  expect(spendBasis([row(12)])).toBe(spendBasis([row(97)]));
});

test('an exhausted window or a failure moves the basis', () => {
  expect(spendBasis([row(100)])).not.toBe(spendBasis([row(97)]));
  expect(spendBasis([row(12, { failedAt: NOW })])).not.toBe(spendBasis([row(12)]));
});

test('a provider signing with another provider’s sign-in names the account that row carries', () => {
  const models: ServedModels = modelCatalog(
    SHIPPED_SERVED.map((provider) => (provider.id === 'subscription' ? { ...provider, accountSource: 'claude-code' } : provider)),
  );
  const lent = [row(12, { provider: 'claude-code' })];
  expect(paysWords(models, { provider: 'subscription', account: 'k1' }, lent)).toBe('Claude · work@example.com');
});
