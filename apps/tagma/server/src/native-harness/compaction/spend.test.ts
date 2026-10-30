import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { describe, expect, test } from 'bun:test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import type { AccountQuotaRow } from '../../providers/contract/wire/accounts.js';
import type { ProviderCatalog } from '../../providers/contract/service/registry.js';
import { admitSummarizer, foldOf, summarizerSpend, type SummarizedThread } from './spend.js';

const MODELS = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

const catalogOf = (programs: ReadonlySet<string>) =>
  ({
    models: MODELS,
    accountSource: (provider: string) => provider,
    asks: {
      answers: (provider: string) => MODELS.registered(provider) && (MODELS.named(provider).auth !== 'cli' || programs.has(provider)),
    },
  }) as unknown as ProviderCatalog;

const CATALOG = catalogOf(new Set());

const NOW = Date.parse('2026-09-25T16:00:00.000Z');

const anthropic: AccountQuotaRow = {
  provider: 'subscription',
  account: AccountKey.make('key-1'),
  label: 'Key key-1',
  origin: { kind: 'own' },
  problem: null,
  default: true,
  quota: null,
  restored: false,
  failure: null,
  failedAt: null,
};

const claudeCode: SummarizedThread = {
  provider: 'claude-code',
  model: 'claude-opus-5-5',
  account: null,
  compaction: 'session',
};

const native: SummarizedThread = {
  provider: 'subscription',
  model: 'claude-opus-5-5',
  account: 'key-1',
  compaction: 'core',
};

describe('what a summarizer costs the thread it summarizes', () => {
  test('a thread whose vendor session folds its context spends nothing of ours on its own model, and names it as the summarizer', () => {
    const own = { provider: 'claude-code', model: 'claude-opus-5-5' };
    expect(foldOf(claudeCode, own)).toBe('session');
    expect(summarizerSpend(CATALOG, claudeCode, own, [], NOW)).toEqual({ spendable: true, account: null });
    expect(admitSummarizer(CATALOG, claudeCode, { ...own, reasoning: 'high' })).toEqual({
      provider: 'claude-code',
      model: 'claude-opus-5-5',
      reasoning: 'high',
    });
  });

  test('a model the catalog no longer serves still folds that thread in its own session, with the rung it was asked for', () => {
    const stale: SummarizedThread = { ...claudeCode, model: 'claude-opus-4-5' };
    const own = { provider: 'claude-code', model: 'claude-opus-4-5', reasoning: 'high' };
    expect(summarizerSpend(CATALOG, stale, own, [], NOW)).toEqual({ spendable: true, account: null });
    expect(admitSummarizer(CATALOG, stale, own)).toEqual({ provider: 'claude-code', model: 'claude-opus-4-5', reasoning: 'high' });
    expect(admitSummarizer(CATALOG, { ...stale, compaction: 'core' }, own)).toBeNull();
  });

  test('another model summarizing that same thread is called by the server, so the allowance table judges it', () => {
    const other = { provider: 'subscription', model: 'claude-opus-5-5' };
    expect(foldOf(claudeCode, other)).toBe('core');
    expect(summarizerSpend(CATALOG, claudeCode, other, [], NOW)).toEqual({ spendable: false, reason: 'not-connected' });
    expect(summarizerSpend(CATALOG, claudeCode, other, [anthropic], NOW)).toEqual({ spendable: true, account: 'key-1' });
  });

  test('the thread’s own model folded by the server is judged by the account the thread is pinned to, not by the default', () => {
    const pinned = { ...anthropic, account: AccountKey.make('key-2'), default: false };
    const full = new QuotaObservation({
      observedAt: new Date(NOW),
      source: 'usage',
      windows: [new QuotaWindow({ kind: 'weekly', usedPercent: 100, resetsAt: NOW / 1_000 + 3_600 })],
    });
    const table = [{ ...anthropic, quota: full }, pinned];
    const own = { provider: 'subscription', model: 'claude-opus-5-5' };
    expect(summarizerSpend(CATALOG, { ...native, account: 'key-2' }, own, table, NOW)).toEqual({ spendable: true, account: 'key-2' });
    expect(summarizerSpend(CATALOG, { ...native, account: null }, own, table, NOW)).toMatchObject({ spendable: false, reason: 'quota' });
  });

  test('a model that answers no text ask is refused for a thread the server folds itself, its own model included', () => {
    const cli: SummarizedThread = { ...native, provider: 'claude-code' };
    const own = { provider: 'claude-code', model: 'claude-opus-5-5' };
    expect(foldOf(cli, own)).toBe('core');
    expect(summarizerSpend(CATALOG, cli, own, [anthropic], NOW)).toEqual({ spendable: false, reason: 'not-callable' });
    expect(admitSummarizer(CATALOG, cli, own)).toBeNull();
    expect(admitSummarizer(CATALOG, native, { provider: 'claude-code', model: 'claude-opus-5-5' })).toBeNull();
    expect(admitSummarizer(CATALOG, native, { provider: 'subscription', model: 'no-such-model' })).toBeNull();
  });

  test('a CLI that answers text asks summarizes any thread, its own rebuilt one included', () => {
    const programmed = catalogOf(new Set(['claude-code']));
    const foreign: SummarizedThread = { ...native, provider: 'claude-code', compaction: 'foreign' };
    const own = { provider: 'claude-code', model: 'claude-opus-5-5' };
    expect(summarizerSpend(programmed, foreign, own, [], NOW)).toEqual({ spendable: true, account: 'key-1' });
    expect(summarizerSpend(programmed, native, own, [], NOW)).toEqual({ spendable: true, account: null });
    expect(admitSummarizer(programmed, foreign, own)).toMatchObject({ provider: 'claude-code', model: 'claude-opus-5-5' });
    expect(summarizerSpend(CATALOG, foreign, own, [], NOW)).toEqual({ spendable: false, reason: 'not-callable' });
  });
});
