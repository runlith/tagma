import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import type { QuotaTable } from '../../providers/contract/wire/accounts.js';
import { AccountKey } from '@runlith/llm/models/authStatus';
import type { CompactionSummarizer, SummarizerRule } from '../contract/wire/compactionSettings.js';
import { NATIVE_CAPABILITIES, type TransportCapabilities } from '@runlith/agent/thread/record';
import type { ThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { CacheWarmth, type ThreadEvidence } from '../../threads/contract/service/evidence.js';
import { AccountQuota } from '../../providers/contract/service/quota.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import type { NativeThreadRows } from '../rows/native.js';
import { compactionSummarizerRule } from '../contract/wire/compactionSettings.js';
import { makeChoiceReader } from './choice.js';

const MODELS = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

const PROJECT = 7;
const THREAD = 'thread-under-choice';
const ACCOUNTS: QuotaTable = [
  {
    provider: 'opencode-go',
    account: AccountKey.make('summary-key'),
    label: 'Summary',
    origin: { kind: 'own' },
    problem: null,
    default: true,
    quota: null,
    restored: false,
    failure: null,
    failedAt: null,
  },
];

const readerOf = (
  compaction: TransportCapabilities['compaction'],
  configured: readonly CompactionSummarizer[] = [],
  provider = 'claude-code',
  rule: SummarizerRule = 'when-cold',
  table: QuotaTable = ACCOUNTS,
) =>
  makeChoiceReader({
    rows: { historyOf: () => Effect.succeed([]) } as unknown as NativeThreadRows,
  }).pipe(
    Effect.provideService(CacheWarmth, {} as unknown as CacheWarmth['Service']),
    Effect.provideService(ThreadLookup, {
      summary: () =>
        Effect.succeed({
          id: THREAD,
          ownerId: OPERATOR_PRINCIPAL,
          projectId: PROJECT,
          provider,
          model: 'claude-opus-5-5',
          reasoning: 'high',
          account: null,
          switches: null,
          capabilities: { ...NATIVE_CAPABILITIES, compaction },
          activeRun: { id: 'run-going' },
        }),
    } as unknown as ThreadLookup['Service']),
    Effect.provideService(ThreadRecords, { projectOf: () => Effect.succeed(PROJECT) } as unknown as ThreadRecords['Service']),
    Effect.provideService(Settings, {
      value: (setting: { readonly id: string }) => Effect.succeed(setting.id === compactionSummarizerRule.id ? rule : configured),
    } as unknown as Settings['Service']),
    Effect.provideService(AccountQuota, {
      table: () => Effect.succeed(table),
    } as unknown as AccountQuota['Service']),
    Effect.provideService(ProviderRegistry, {
      catalog: Effect.succeed({ models: MODELS, accountSource: (provider: string) => provider }),
    } as unknown as ProviderRegistry['Service']),
  );

const menuOf = (
  compaction: TransportCapabilities['compaction'],
  configured: readonly CompactionSummarizer[] = [],
  provider = 'claude-code',
  rule: SummarizerRule = 'when-cold',
  table: QuotaTable = ACCOUNTS,
) =>
  Effect.flatMap(readerOf(compaction, configured, provider, rule, table), (reader) =>
    reader.read(
      { composition: () => Effect.succeed({ parts: [] }) } as unknown as ThreadEvidence['Service'],
      { estimate: () => Effect.succeed({ own: { inputTokens: 40_000, passes: 1 }, candidates: [] }) } as unknown as ThreadCompaction,
      THREAD,
      PROJECT,
      {},
    ),
  );

it.effect(
  'a thread folding in its own vendor session may be summarized by its own model, which no quota of ours judges, while every other row is',
  () =>
    Effect.gen(function* () {
      const menu = yield* menuOf('session');

      expect(menu.own).toMatchObject({
        provider: 'claude-code',
        model: 'claude-opus-5-5',
        own: true,
        folds: 'session',
        spendable: true,
        skip: null,
      });
      expect(menu.resolved).toMatchObject({ kind: 'own', choice: { own: true, folds: 'session' } });
      expect(menu.others.rows.some((row) => row.provider === 'claude-code')).toBe(false);
      expect(menu.others.rows.every((row) => row.folds === 'core')).toBe(true);
      expect(menu.others.rows.find((row) => row.provider === 'subscription')?.skip?.reason).toBe('not-connected');

      const named = yield* (yield* readerOf('session')).admit(THREAD, {
        provider: 'claude-code',
        model: 'claude-opus-5-5',
        reasoning: 'high',
      });
      expect(named).toEqual({ provider: 'claude-code', model: 'claude-opus-5-5', reasoning: 'high' });
    }),
);

it.effect('the automatic chain and menu keep an own vendor-session model spendable, while a native thread skips that CLI model', () =>
  Effect.gen(function* () {
    const own = { provider: 'claude-code', model: 'claude-opus-5-5', reasoning: 'high' };
    const api = { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoning: 'high' };
    const chain = [own, api];
    const reader = yield* readerOf('session', chain, own.provider, 'always');
    expect(yield* reader.summarizers({ threadId: THREAD, running: true })).toMatchObject({
      kind: 'chain',
      members: [own, api],
      skipped: [],
    });
    expect((yield* menuOf('session', chain, own.provider, 'always')).resolved).toMatchObject({
      kind: 'chain',
      choice: { ...own, own: true, folds: 'session', spendable: true },
    });
    const native = yield* readerOf('core', chain, 'subscription', 'always');
    expect(yield* native.summarizers({ threadId: THREAD, running: true })).toMatchObject({
      kind: 'chain',
      members: [api],
      skipped: [{ provider: own.provider, model: own.model, reason: 'not-callable' }],
    });
  }),
);

it.effect('a foreign-only session chooses a spendable foreign chain even while running, and refuses its own provider', () =>
  Effect.gen(function* () {
    const own = { provider: 'subscription', model: 'claude-opus-5-5' };
    const other = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' };
    const chain = [own, other];
    const menu = yield* menuOf('foreign', chain, own.provider);
    expect(menu.own).toBeNull();
    expect(menu.chain.map((row) => row.provider)).toEqual([other.provider]);
    expect(menu.others.rows.every((row) => row.provider !== own.provider)).toBe(true);
    expect(menu.resolved).toMatchObject({
      kind: 'chain',
      reason: 'foreign',
      choice: { ...other, folds: 'core', spendable: true },
      skipped: [{ ...own, reason: 'not-callable' }],
    });
    const reader = yield* readerOf('foreign', chain, own.provider);
    expect(yield* reader.summarizers({ threadId: THREAD, running: true })).toMatchObject({
      kind: 'chain',
      reason: 'foreign',
      members: [{ ...other, account: 'summary-key' }],
    });
    expect(yield* Effect.flip(reader.admit(THREAD, own))).toMatchObject({ code: 'unknown-summarizer' });
    expect((yield* menuOf('foreign')).resolved).toMatchObject({ kind: 'none', reason: 'foreign', choice: null });
  }),
);

it.effect('an empty chain keeps the own model under every rule, while unavailable members keep their refusal reasons and quota reset', () =>
  Effect.gen(function* () {
    for (const rule of ['never', 'when-cold', 'always'] as const) {
      const menu = yield* menuOf('core', [], 'subscription', rule);
      expect(menu.resolved).toMatchObject({ kind: 'own', reason: rule === 'never' ? 'never' : 'unchained' });
    }
    const now = yield* Clock.currentTimeMillis;
    const reset = Math.floor(now / 1_000) + 3_600;
    const table: QuotaTable = [
      {
        ...ACCOUNTS[0]!,
        provider: 'muse',
        quota: new QuotaObservation({
          observedAt: new Date(now),
          source: 'usage',
          windows: [new QuotaWindow({ kind: 'weekly', usedPercent: 100, resetsAt: reset })],
        }),
      },
    ];
    const chain = [
      { provider: 'opencode-go', model: 'retired-model' },
      { provider: 'muse', model: 'muse-spark-1.3' },
    ];
    const menu = yield* menuOf('core', chain, 'subscription', 'always', table);
    expect(menu.chain.map((row) => [row.model, row.skip?.reason])).toEqual([
      ['retired-model', 'unknown-model'],
      ['muse-spark-1.3', 'quota'],
    ]);
    expect(menu.chain[0]?.estimate).toBeNull();
    expect(menu.chain[1]?.skip?.until).toBe(new Date(reset * 1_000).toISOString());
    expect(menu.resolved).toMatchObject({ kind: 'none', reason: 'always', choice: null });
    const reader = yield* readerOf('core', chain, 'subscription', 'always', table);
    expect(yield* reader.summarizers({ threadId: THREAD, running: true })).toMatchObject({
      kind: 'none',
      reason: 'always',
      skipped: [
        { provider: 'opencode-go', model: 'retired-model', reason: 'unknown-model' },
        { provider: 'muse', model: 'muse-spark-1.3', reason: 'quota', until: new Date(reset * 1_000).toISOString() },
      ],
    });
    const project = yield* reader.chainAt('project', PROJECT);
    expect([project.rule, project.chain.map((row) => [row.model, row.skip?.reason])]).toEqual([
      'always',
      [
        ['retired-model', 'unknown-model'],
        ['muse-spark-1.3', 'quota'],
      ],
    ]);
    expect(project.chain[1]?.skip?.until).toBe(new Date(reset * 1_000).toISOString());
  }),
);

it.effect('the same model on a thread the server folds itself is neither offered nor admitted: only its CLI calls it', () =>
  Effect.gen(function* () {
    const menu = yield* menuOf('core');

    expect(menu.own).toMatchObject({ own: true, folds: 'core', spendable: false, skip: { reason: 'not-callable' } });

    const refused = yield* Effect.flip((yield* readerOf('core')).admit(THREAD, { provider: 'claude-code', model: 'claude-opus-5-5' }));
    expect(refused).toBeInstanceOf(GateRefusal);
    expect((refused as GateRefusal<string>).code).toBe('unknown-summarizer');
  }),
);
