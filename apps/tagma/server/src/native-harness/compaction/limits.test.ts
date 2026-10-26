import { expect, test } from 'bun:test';
import { Effect, Result } from 'effect';
import { resolveModelCall } from '@runlith/llm/models/resolve';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { resolveCompactionTrigger, threadUsableTokens } from '@runlith/agent/thread/compaction/policy';
import { providerCatalogOf } from '../../providers/testing/registry.js';
import { COMPACTION_POLICY } from './policy.js';
import { contextLimitOf } from './limits.js';

const credentials: ModelCredentials = {
  apiKey: async () => 'key',
  accessToken: async () => 'token',
  credential: async () => {
    throw new Error('No request is sent.');
  },
};

const PROVIDER = 'limit-provider';
const MODEL = 'limit-model';

const catalog = providerCatalogOf([
  {
    id: PROVIDER,
    label: 'Limit provider',
    kind: 'wire',
    auth: 'api-key',
    models: {
      [MODEL]: {
        label: 'Limit model',
        capacity: { context: 400_000, output: 128_000 },
        capabilities: ['text'],
        reasoning: [],
        defaultReasoning: null,
      },
    },
    cacheLifetime: { promisedSeconds: null, prior: null },
    defaultTextModel: MODEL,
    profile: {
      model: () => Effect.die('No model is called.'),
      options: () => undefined,
      output: { budget: 32_000, sent: false },
    },
    quota: { read: () => Effect.die('No quota is read.'), fromHeaders: () => null },
  },
]);

test('the point a native thread compacts at is the threshold its next step is held to, under the pair override', () => {
  const policy = COMPACTION_POLICY(0.2, { strategy: 'percent', trigger: 0.8 }, [
    { provider: PROVIDER, model: MODEL, strategy: 'reserve-output' },
  ]);
  const option = catalog.models.resolveTextModel(PROVIDER, MODEL);
  const call = Result.getOrThrow(resolveModelCall(catalog.wires, { ownerId: 'owner', provider: PROVIDER, model: MODEL, credentials }));
  const trigger = resolveCompactionTrigger({ provider: PROVIDER, model: MODEL, policy, row: option.compactionTrigger });

  const limit = contextLimitOf(catalog, policy, { provider: PROVIDER, model: MODEL, compaction: 'core', measured: null, off: false });

  expect(limit).toEqual({
    window: 400_000,
    compaction: {
      at: threadUsableTokens(option.capacity!, call.plannedOutputTokens, policy, trigger),
      strategy: 'reserve-output',
      share: null,
      source: 'override',
    },
  });
  expect(limit?.compaction?.at).toBe(368_000);
});

test('a thread on the provider default is limited by the default model', () => {
  const policy = COMPACTION_POLICY(0.2, { strategy: 'percent', trigger: 0.55 });

  expect(contextLimitOf(catalog, policy, { provider: PROVIDER, model: null, compaction: 'core', measured: null, off: false })).toEqual({
    window: 400_000,
    compaction: { at: 220_000, strategy: 'percent', share: 0.55, source: 'global' },
  });
});

test('a thread nothing compacts is limited by its window alone', () => {
  const policy = COMPACTION_POLICY(0.2);

  for (const input of [
    { compaction: 'core', off: true },
    { compaction: 'none', off: false },
  ] as const) {
    expect(contextLimitOf(catalog, policy, { provider: PROVIDER, model: MODEL, measured: null, ...input })).toEqual({
      window: 400_000,
      compaction: null,
    });
  }
});

test('a harness session compacts against the window its agent measured, by the share in force', () => {
  const policy = COMPACTION_POLICY(0.2, { strategy: 'percent', trigger: 0.5 });

  expect(
    contextLimitOf(catalog, policy, { provider: 'outside-harness', model: null, compaction: 'session', measured: 300_000, off: true }),
  ).toEqual({ window: 300_000, compaction: { at: 150_000, strategy: 'percent', share: 0.5, source: 'global' } });
});
