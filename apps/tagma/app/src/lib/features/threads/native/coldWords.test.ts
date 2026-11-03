import { modelCatalog } from '@runlith/llm/models/catalog';
import { Usage } from '@runlith/llm/schema/events';
import { expect, test } from 'vitest';
import { SHIPPED_SERVED } from '$lib/features/providers/testing.js';
import { type ColdBasis, coldWords } from './coldWords.js';

const MODELS = modelCatalog(SHIPPED_SERVED);
const NOW = Date.parse('2026-11-03T12:00:00Z');

const basis = (fields: Partial<ColdBasis> = {}): ColdBasis => ({
  reading: {
    usage: new Usage({ inputTokens: 184_000, cacheReadInputTokens: 180_000 }),
    contextWindow: 1_000_000,
    runId: 'run-1',
    stepNumber: 3,
    provider: 'subscription',
    model: 'claude-opus-5-5',
    reasoning: 'high',
    measuredAt: new Date(NOW - 60_000).toISOString(),
    cache: { ttlSeconds: 3_600 },
    stale: false,
  },
  warm: true,
  account: null,
  compacting: false,
  ...fields,
});

const pick = (model: string, rung: string | null) => ({ provider: 'subscription', model, rung });

test('a pick that drops a warm cache names the context it reads cold; one that keeps it says nothing', () => {
  expect(coldWords(MODELS, basis(), pick('claude-sonnet-5-5', 'high'), NOW)).toContain('184k');
  expect(coldWords(MODELS, basis(), pick('claude-opus-5-5', 'xhigh'), NOW)).toContain('184k');
  expect(coldWords(MODELS, basis(), pick('claude-opus-5-5', 'high'), NOW)).toBeNull();
});

test('a cold cache loses nothing, and a pending compaction is read cold instead of the full context', () => {
  expect(coldWords(MODELS, basis({ warm: false }), pick('claude-sonnet-5-5', 'high'), NOW)).toBeNull();
  const after = coldWords(MODELS, basis({ compacting: true }), pick('claude-sonnet-5-5', 'high'), NOW);
  expect(after).not.toBeNull();
  expect(after).not.toContain('184k');
});
