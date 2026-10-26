import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { describe, expect, test } from 'bun:test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { QuotaObservation, QuotaRateLimited, QuotaUnsupported, QuotaWindow } from '@runlith/llm/schema/quota';
import type { AccountQuotaRow } from '../../providers/contract/wire/accounts.js';
import type { ProviderCatalog } from '../../providers/contract/service/registry.js';
import { spendability, turnSpendability } from './spendability.js';

const MODELS = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

const catalogOf = (accountSource: (provider: string) => string) => ({ models: MODELS, accountSource }) as unknown as ProviderCatalog;

const CATALOG = catalogOf((provider) => provider);

const NOW = Date.parse('2026-09-25T16:00:00.000Z');
const AHEAD = NOW / 1_000 + 3_600;
const PAST = NOW / 1_000 - 60;

const row = (patch: Partial<AccountQuotaRow> & Pick<AccountQuotaRow, 'provider'>): AccountQuotaRow => ({
  account: AccountKey.make('key-1'),
  label: 'Key key-1',
  origin: { kind: 'own' },
  problem: null,
  default: true,
  quota: null,
  restored: false,
  failure: null,
  failedAt: null,
  ...patch,
});

const windows = (...each: ConstructorParameters<typeof QuotaWindow>[0][]) =>
  new QuotaObservation({ observedAt: new Date(NOW), source: 'usage', windows: each.map((window) => new QuotaWindow(window)) });

describe('whether a model may be spent now', () => {
  test('a connected provider signs with its default account, else its only one', () => {
    expect(spendability(CATALOG, 'opencode-go', 'deepseek-v4.1-flash', [row({ provider: 'opencode-go' })], NOW)).toEqual({
      spendable: true,
      account: 'key-1',
    });
    expect(spendability(CATALOG, 'opencode-go', 'deepseek-v4.1-flash', [row({ provider: 'opencode-go', default: false })], NOW)).toEqual({
      spendable: true,
      account: 'key-1',
    });
    expect(
      spendability(
        CATALOG,
        'opencode-go',
        'deepseek-v4.1-flash',
        [
          row({ provider: 'opencode-go', default: false }),
          row({ provider: 'opencode-go', default: false, account: AccountKey.make('key-2') }),
        ],
        NOW,
      ),
    ).toEqual({ spendable: false, reason: 'no-account' });
    expect(spendability(CATALOG, 'opencode-go', 'deepseek-v4.1-flash', [], NOW)).toEqual({ spendable: false, reason: 'not-connected' });
  });

  test('a provider whose account mode signs with another provider’s sign-in is judged by that provider’s row', () => {
    const borrowing = catalogOf((provider) => (provider === 'subscription' ? 'claude-code' : provider));
    const lent = [row({ provider: 'claude-code' })];
    expect(spendability(borrowing, 'subscription', 'claude-opus-5-5', lent, NOW)).toEqual({ spendable: true, account: 'key-1' });
    const full = [row({ provider: 'claude-code', quota: windows({ kind: 'weekly', usedPercent: 100, resetsAt: AHEAD }) })];
    expect(spendability(borrowing, 'subscription', 'claude-opus-5-5', full, NOW)).toEqual({
      spendable: false,
      reason: 'quota',
      until: AHEAD * 1_000,
    });
    expect(spendability(CATALOG, 'subscription', 'claude-opus-5-5', lent, NOW)).toEqual({ spendable: false, reason: 'not-connected' });
  });

  test('a full window with its reset ahead holds the account until the last such reset; a reset already passed does not', () => {
    const full = [
      row({
        provider: 'muse',
        quota: windows(
          { kind: 'session', usedPercent: 100, resetsAt: AHEAD },
          { kind: 'weekly', usedPercent: 100, resetsAt: AHEAD + 600 },
          { kind: 'model', model: 'Fable', usedPercent: 40, resetsAt: AHEAD + 900 },
        ),
      }),
    ];
    expect(spendability(CATALOG, 'muse', 'muse-spark-1.3', full, NOW)).toEqual({
      spendable: false,
      reason: 'quota',
      until: (AHEAD + 600) * 1_000,
    });
    const reset = [row({ provider: 'muse', quota: windows({ kind: 'weekly', usedPercent: 100, resetsAt: PAST }) })];
    expect(spendability(CATALOG, 'muse', 'muse-spark-1.3', reset, NOW)).toEqual({ spendable: true, account: 'key-1' });
  });

  test('a named account is judged by its own windows, never by the default’s, and a name no row holds signs with nothing', () => {
    const table = [
      row({ provider: 'muse', quota: windows({ kind: 'weekly', usedPercent: 100, resetsAt: AHEAD }) }),
      row({ provider: 'muse', default: false, account: AccountKey.make('key-2') }),
    ];
    expect(spendability(CATALOG, 'muse', 'muse-spark-1.3', table, NOW)).toMatchObject({ spendable: false, reason: 'quota' });
    expect(spendability(CATALOG, 'muse', 'muse-spark-1.3', table, NOW, 'key-2')).toEqual({ spendable: true, account: 'key-2' });
    expect(spendability(CATALOG, 'muse', 'muse-spark-1.3', table, NOW, 'key-3')).toEqual({ spendable: false, reason: 'no-account' });
  });

  test('a per-model window holds only the model it names', () => {
    const table = [
      row({
        provider: 'subscription',
        quota: windows({ kind: 'model', label: 'Fable', model: 'Fable', usedPercent: 100, resetsAt: AHEAD }),
      }),
    ];
    expect(spendability(CATALOG, 'subscription', 'claude-fable-5-1', table, NOW)).toMatchObject({ spendable: false, reason: 'quota' });
    expect(spendability(CATALOG, 'subscription', 'claude-opus-5-5', table, NOW)).toEqual({ spendable: true, account: 'key-1' });
  });

  test('a rate limit holds the account until its Retry-After runs out; a deployment with no usage read stays spendable', () => {
    const limited = [row({ provider: 'opencode-go', failure: new QuotaRateLimited({ retryAfterMs: 60_000 }), failedAt: NOW - 10_000 })];
    expect(spendability(CATALOG, 'opencode-go', 'deepseek-v4.1-flash', limited, NOW)).toEqual({
      spendable: false,
      reason: 'rate-limited',
      until: NOW + 50_000,
    });
    expect(spendability(CATALOG, 'opencode-go', 'deepseek-v4.1-flash', limited, NOW + 60_000)).toEqual({
      spendable: true,
      account: 'key-1',
    });
    const unread = [row({ provider: 'opencode-go', failure: new QuotaUnsupported(), failedAt: NOW })];
    expect(spendability(CATALOG, 'opencode-go', 'deepseek-v4.1-flash', unread, NOW)).toEqual({ spendable: true, account: 'key-1' });
  });

  test('a CLI turn spends its own quota windows while a direct model call remains unavailable', () => {
    const table = [
      row({
        provider: 'claude-code',
        quota: windows({ kind: 'session', usedPercent: 100, resetsAt: AHEAD }, { kind: 'weekly', usedPercent: 100, resetsAt: AHEAD + 600 }),
      }),
      row({ provider: 'claude-code', account: AccountKey.make('key-2'), default: false }),
    ];
    expect(turnSpendability(CATALOG, 'claude-code', 'claude-opus-5-5', table, NOW)).toEqual({
      spendable: false,
      reason: 'quota',
      until: (AHEAD + 600) * 1_000,
    });
    expect(turnSpendability(CATALOG, 'claude-code', 'claude-opus-5-5', table, NOW, 'key-2')).toEqual({
      spendable: true,
      account: 'key-2',
    });
    expect(turnSpendability(CATALOG, 'claude-code', 'claude-opus-5-5', table, (AHEAD + 600) * 1_000)).toMatchObject({
      spendable: true,
    });
    expect(turnSpendability(CATALOG, 'claude-code', 'claude-opus-5-5', [], NOW)).toEqual({ spendable: true, account: null });
    expect(spendability(CATALOG, 'claude-code', 'claude-opus-5-5', table, NOW)).toEqual({ spendable: false, reason: 'not-callable' });
  });

  test('a non-CLI turn keeps the direct call spendability verdict', () => {
    const table = [row({ provider: 'muse', quota: windows({ kind: 'weekly', usedPercent: 100, resetsAt: AHEAD }) })];
    expect(turnSpendability(CATALOG, 'muse', 'muse-spark-1.3', table, NOW)).toEqual(
      spendability(CATALOG, 'muse', 'muse-spark-1.3', table, NOW),
    );
  });

  test('a model the catalog does not hold, or one only an installed CLI calls, is never spendable here', () => {
    expect(spendability(CATALOG, 'opencode-go', 'no-such-model', [row({ provider: 'opencode-go' })], NOW)).toEqual({
      spendable: false,
      reason: 'unknown-model',
    });
    expect(spendability(CATALOG, 'claude-code', 'claude-opus-5-5', [], NOW)).toEqual({ spendable: false, reason: 'not-callable' });
  });
});
