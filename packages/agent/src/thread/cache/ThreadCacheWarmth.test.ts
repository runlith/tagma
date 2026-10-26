import { describe, expect, test } from 'bun:test';
import { Usage } from '@runlith/llm/schema/events';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';

const { resolveTextModel } = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);
import type { ThreadContextReading } from '../rows';
import type { ThreadCacheCurveReading } from './ThreadCacheCurve';
import { threadCacheWarmth } from './ThreadCacheWarmth';

const MEASURED_AT = Date.UTC(2026, 8, 10, 10, 0, 0);
const minutesLater = (minutes: number) => MEASURED_AT + minutes * 60_000;

const reading = (provider: string, model: string, ttlSeconds: number | null, stale = false): ThreadContextReading => ({
  usage: new Usage({ inputTokens: 480_000, cacheReadInputTokens: 470_000 }),
  contextWindow: 1_000_000,
  runId: 'run-1',
  stepNumber: 7,
  provider,
  model,
  measuredAt: new Date(MEASURED_AT).toISOString(),
  sentAt: new Date(MEASURED_AT - 8_000).toISOString(),
  cache: { ttlSeconds },
  stale,
});

const curveWith = (sample: number): ThreadCacheCurveReading => ({
  provider: 'openai-oauth',
  buckets: [{ gap: '30–60m', sample, warmShare: 0.74, oldestAt: '2026-09-09T12:00:00.000Z' }],
});

describe('threadCacheWarmth', () => {
  test('a promised lifetime answers warm until the last request was sent plus the ttl, then cold; a reading with no send instant counts from its answer', () => {
    const lifetime = resolveTextModel('subscription', 'claude-opus-5-5').cacheLifetime;
    const input = {
      reading: reading('subscription', 'claude-opus-5-5', 3_600),
      selection: { provider: 'subscription', model: 'claude-opus-5-5', account: null },
      lifetime,
      curve: null,
    };
    expect(threadCacheWarmth({ ...input, now: minutesLater(13) })).toMatchObject({
      state: 'warm',
      basis: 'promise',
      heldTokens: 480_000,
      expiresAt: new Date(minutesLater(60) - 8_000).toISOString(),
    });
    expect(threadCacheWarmth({ ...input, now: minutesLater(60) - 1_000 })).toMatchObject({ state: 'cold', basis: 'promise' });
    const { sentAt: _sent, ...unsent } = input.reading;
    expect(threadCacheWarmth({ ...input, reading: unsent, now: minutesLater(13) })).toMatchObject({
      expiresAt: new Date(minutesLater(60)).toISOString(),
    });
  });

  test('a catalog promise cannot supply a cache term the request did not evidence', () => {
    const lifetime = resolveTextModel('subscription', 'claude-opus-5-5').cacheLifetime;
    const recorded = reading('subscription', 'claude-opus-5-5', null);
    const { cache: _cache, ...unrecorded } = recorded;
    for (const observed of [recorded, unrecorded]) {
      expect(
        threadCacheWarmth({
          reading: observed,
          selection: { provider: 'subscription', model: 'claude-opus-5-5', account: null },
          lifetime,
          curve: null,
          now: minutesLater(5),
        }),
      ).toMatchObject({ state: 'unknown', basis: 'none', expiresAt: null });
    }
  });

  test('an unpromised lifetime reads the installation`s bucket past the floor, else the deployment`s prior', () => {
    const lifetime = resolveTextModel('openai-oauth', 'gpt-5.6-sol').cacheLifetime;
    const input = {
      reading: reading('openai-oauth', 'gpt-5.6-sol', null),
      selection: { provider: 'openai-oauth', model: 'gpt-5.6-sol', account: null },
      lifetime,
      now: minutesLater(40),
    };
    expect(threadCacheWarmth({ ...input, curve: curveWith(23) })).toMatchObject({
      state: 'likely',
      basis: 'local',
      warmShare: 0.74,
      sample: 23,
      oldestAt: '2026-09-09T12:00:00.000Z',
    });
    expect(threadCacheWarmth({ ...input, curve: curveWith(12) })).toMatchObject({
      state: 'likely',
      basis: 'prior',
      warmShare: 0.74,
      sample: 23,
      oldestAt: '2026-09-10',
    });
  });

  test('no promise, no rows and no prior is unknown; a staled or re-selected reading is cold whatever the clock says', () => {
    const xai = resolveTextModel('xai', 'grok-4.6').cacheLifetime;
    expect(
      threadCacheWarmth({
        reading: reading('xai', 'grok-4.6', null),
        selection: { provider: 'xai', model: 'grok-4.6', account: null },
        lifetime: xai,
        curve: null,
        now: minutesLater(5),
      }),
    ).toMatchObject({ state: 'unknown', basis: 'none', heldTokens: 480_000 });
    expect(
      threadCacheWarmth({
        reading: null,
        selection: { provider: 'xai', model: 'grok-4.6', account: null },
        lifetime: xai,
        curve: null,
        now: minutesLater(5),
      }),
    ).toMatchObject({ state: 'unknown', heldTokens: null });

    const anthropic = resolveTextModel('subscription', 'claude-opus-5-5').cacheLifetime;
    const selection = { provider: 'subscription', model: 'claude-opus-5-5', account: null };
    expect(
      threadCacheWarmth({
        reading: reading('subscription', 'claude-opus-5-5', 3_600, true),
        selection,
        lifetime: anthropic,
        curve: null,
        now: minutesLater(1),
      }),
    ).toMatchObject({ state: 'cold', invalidatedBy: 'compaction', expiresAt: null });
    expect(
      threadCacheWarmth({
        reading: reading('subscription', 'claude-sonnet-5', 3_600),
        selection,
        lifetime: anthropic,
        curve: null,
        now: minutesLater(1),
      }),
    ).toMatchObject({ state: 'cold', invalidatedBy: 'selection' });
  });

  test('a reading made on another account than the next request`s is cold; an account either side does not know never invalidates', () => {
    const lifetime = resolveTextModel('subscription', 'claude-opus-5-5').cacheLifetime;
    const signed = { ...reading('subscription', 'claude-opus-5-5', 3_600), account: 'work' };
    const next = (account: string | null) => ({ provider: 'subscription', model: 'claude-opus-5-5', account });
    const at = { lifetime, curve: null, now: minutesLater(5) };
    expect(threadCacheWarmth({ reading: signed, selection: next('personal'), ...at })).toMatchObject({
      state: 'cold',
      invalidatedBy: 'account',
      heldTokens: 480_000,
    });
    expect(threadCacheWarmth({ reading: signed, selection: next('work'), ...at })).toMatchObject({ state: 'warm', invalidatedBy: null });
    expect(threadCacheWarmth({ reading: signed, selection: next(null), ...at })).toMatchObject({ state: 'warm', invalidatedBy: null });
    expect(
      threadCacheWarmth({ reading: reading('subscription', 'claude-opus-5-5', 3_600), selection: next('personal'), ...at }),
    ).toMatchObject({ state: 'warm', invalidatedBy: null });
  });

  test('another rung is cold only where the deployment keys its cache by reasoning, and a rung either side does not know never invalidates', () => {
    const anthropic = resolveTextModel('subscription', 'claude-opus-5-5').cacheLifetime;
    const high = { ...reading('subscription', 'claude-opus-5-5', 3_600), reasoning: 'high' };
    const next = (reasoning?: string | null) => ({
      provider: 'subscription',
      model: 'claude-opus-5-5',
      account: null,
      reasoning: reasoning,
    });
    const at = { lifetime: anthropic, curve: null, now: minutesLater(5) };
    expect(threadCacheWarmth({ reading: high, selection: next('xhigh'), ...at })).toMatchObject({
      state: 'cold',
      invalidatedBy: 'reasoning',
    });
    expect(threadCacheWarmth({ reading: high, selection: next('high'), ...at })).toMatchObject({ state: 'warm', invalidatedBy: null });
    expect(threadCacheWarmth({ reading: high, selection: next(), ...at })).toMatchObject({ state: 'warm', invalidatedBy: null });
    expect(
      threadCacheWarmth({ reading: reading('subscription', 'claude-opus-5-5', 3_600), selection: next('xhigh'), ...at }),
    ).toMatchObject({ state: 'warm', invalidatedBy: null });

    const openai = resolveTextModel('openai-oauth', 'gpt-5.6-sol').cacheLifetime;
    const sol = { ...reading('openai-oauth', 'gpt-5.6-sol', null), reasoning: 'high' };
    expect(
      threadCacheWarmth({
        reading: sol,
        selection: { provider: 'openai-oauth', model: 'gpt-5.6-sol', account: null, reasoning: 'xhigh' },
        lifetime: openai,
        curve: null,
        now: minutesLater(40),
      }),
    ).toMatchObject({ basis: 'prior', invalidatedBy: null });
  });
});
