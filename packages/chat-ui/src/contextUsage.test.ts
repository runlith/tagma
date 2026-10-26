import type { SerializedThread } from '@runlith/agent/protocol/http';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import { Usage } from '@runlith/llm/schema/events';
import { describe, expect, test } from 'vitest';
import {
  type ChatLiveContext,
  chatContextSource,
  chatContextUsageDetailRows,
  chatContextUsageMetrics,
  formatContextPercent,
  formatContextTokens,
} from './contextUsage';

describe('context usage labels', () => {
  test('formats compact token and percent labels', () => {
    expect(formatContextTokens(1_050_000)).toBe('1.1M');
    expect(formatContextTokens(12_400)).toBe('12.4K');
    expect(formatContextPercent(0.095)).toBe('0.1%');
    expect(formatContextPercent(42.2)).toBe('42%');
  });
});

describe('the figure the pill reads', () => {
  test('the thread reading answers, with the thread limit and the model of that request', () => {
    expect(chatContextSource({ reading: reading({ totalTokens: 57_000 }), live: null, limit: WINDOW })).toMatchObject({
      reading: 'measured',
      contextTokens: 57_000,
      limit: WINDOW,
      provider: 'subscription',
      model: 'claude-opus-4-8',
    });
  });

  test('the estimate of the call in flight rides beside the thread reading; it never takes its place', () => {
    expect(
      chatContextSource({
        reading: reading({ totalTokens: 57_000 }),
        live: live({ estimate: { stepNumber: 5, tokens: 60_000, contextWindow: 200_000 } }),
      }),
    ).toMatchObject({
      reading: 'measured',
      contextTokens: 57_000,
      nextRequest: { tokens: 60_000 },
    });
  });

  test('a thread that never billed a step shows the estimate as its own figure', () => {
    expect(
      chatContextSource({
        reading: null,
        live: live({ estimate: { stepNumber: 0, tokens: 9_000, contextWindow: 200_000 } }),
      }),
    ).toMatchObject({ reading: 'estimated', contextTokens: 9_000, usage: null });
  });

  test('a compaction leaves the figure unknown, and the next estimate is the first figure after it', () => {
    const stale = reading({ totalTokens: 57_000 }, { stale: true });

    expect(chatContextSource({ reading: stale, live: null })).toMatchObject({
      reading: 'unknown',
      contextTokens: 57_000,
    });
    expect(
      chatContextSource({
        reading: stale,
        live: live({ estimate: { stepNumber: 0, tokens: 9_000, contextWindow: 200_000 } }),
      }),
    ).toMatchObject({
      reading: 'unknown',
      contextTokens: 57_000,
      nextRequest: { tokens: 9_000 },
    });
  });

  test('a thread that measured nothing has no figure and names no model', () => {
    expect(chatContextSource({ reading: null, live: null })).toEqual({
      reading: 'none',
      contextTokens: 0,
      limit: null,
      usage: null,
      provider: null,
      model: null,
      nextRequest: null,
    });
  });
});

describe('the reading dressed for a reader', () => {
  const labels = { providerLabel: 'Anthropic', modelLabel: 'Sonnet 5' };

  test('the share is measured against the point the thread compacts at, and what is left runs to it', () => {
    const metrics = chatContextUsageMetrics({
      ...labels,
      source: chatContextSource({ reading: reading({ totalTokens: 57_000 }), live: null, limit: COMPACTING }),
    });

    expect(metrics).toMatchObject({ limitTokens: 110_000, tokensRemaining: 53_000 });
    expect(metrics?.usagePercent).toBeCloseTo((57_000 / 110_000) * 100, 3);
  });

  test('a thread nothing compacts is measured against its window', () => {
    const metrics = chatContextUsageMetrics({
      ...labels,
      source: chatContextSource({ reading: reading({ totalTokens: 57_000 }), live: null, limit: WINDOW }),
    });

    expect(metrics).toMatchObject({ limitTokens: 200_000, tokensRemaining: 143_000 });
  });

  test('a reduction withdraws occupancy until a provider measures the changed request', () => {
    const before = reading({ inputTokens: 607_789, cacheReadInputTokens: 606_848 }, { contextWindow: 872_000 });
    const limit = { window: 872_000, compaction: null };
    const project = (source: ReturnType<typeof chatContextSource>) => chatContextUsageMetrics({ ...labels, source })!;
    const measured = project(chatContextSource({ reading: before, limit }));
    expect(measured.usagePercent).toBeCloseTo(69.7, 1);

    const reduced = project(
      chatContextSource({
        reading: { ...before!, stale: true },
        live: live({ estimate: { stepNumber: 0, tokens: 427_700, contextWindow: 872_000 } }),
        limit,
      }),
    );
    expect(reduced.reading).toBe('unknown');
    expect(reduced.usagePercent).toBeUndefined();
    expect(reduced.tokensRemaining).toBeUndefined();
    expect(reduced.contextTokens).toBe(607_789);
    expect(reduced.cacheReadInputTokens).toBe(606_848);
    expect(reduced.nextRequestTokens).toBe(427_700);

    const after = project(
      chatContextSource({
        reading: { ...before!, stale: false, usage: new Usage({ inputTokens: 498_334 }) },
        live: null,
        limit,
      }),
    );
    expect(after.reading).toBe('measured');
    expect(after.usagePercent).toBeCloseTo(57.1, 1);
    expect(after.tokensRemaining).toBe(373_666);
    expect(after.nextRequestTokens).toBeUndefined();
  });

  test('a thread with nothing measured shows its limit empty, and nothing without one', () => {
    expect(
      chatContextUsageMetrics({ ...labels, source: chatContextSource({ reading: null, live: null, limit: COMPACTING }) }),
    ).toMatchObject({
      reading: 'none',
      contextTokens: 0,
      limitTokens: 110_000,
      usagePercent: 0,
    });
    expect(chatContextUsageMetrics({ ...labels, source: chatContextSource({ reading: null, live: null }) })).toBeNull();
  });

  test('the wire counters keep their names and the derived ones say they are derived', () => {
    const metrics = chatContextUsageMetrics({
      ...labels,
      source: chatContextSource({
        reading: reading({
          inputTokens: 56_000,
          outputTokens: 952,
          reasoningTokens: 200,
          cacheReadInputTokens: 55_800,
          cacheWriteInputTokens: 145,
          totalTokens: 57_000,
        }),
        live: null,
      }),
    });

    expect(metrics).toMatchObject({
      inputTokens: 56_000,
      outputTokens: 952,
      cacheReadInputTokens: 55_800,
      cacheWriteInputTokens: 145,
      nonCachedInputTokens: 55,
      visibleOutputTokens: 752,
    });
    expect(
      chatContextUsageMetrics({
        ...labels,
        source: chatContextSource({
          reading: reading({ inputTokens: 56_000, nonCachedInputTokens: 40, cacheReadInputTokens: 55_800 }),
          live: null,
        }),
      }),
    ).toMatchObject({ nonCachedInputTokens: 40 });
  });

  test('the detail rows are the disjoint buckets, in reading order', () => {
    const metrics = chatContextUsageMetrics({
      ...labels,
      source: chatContextSource({
        reading: reading({ inputTokens: 15_519, outputTokens: 40, reasoningTokens: 0, cacheReadInputTokens: 0, totalTokens: 15_559 }),
        live: null,
      }),
    });

    expect(chatContextUsageDetailRows(metrics!, 'en', ENGLISH_LABELS)).toEqual([
      { label: 'Input', value: '15.5K' },
      { label: 'Output', value: '40' },
      { label: 'Reasoning', value: '0' },
      { label: 'Cache read', value: '0' },
      { label: 'Total', value: '15.6K' },
    ]);
  });

  test('the attribution is completed here: the remainder is the figure minus the named slices', () => {
    const metrics = chatContextUsageMetrics({
      ...labels,
      source: chatContextSource({ reading: reading({ totalTokens: 57_000 }), live: null }),
      attribution: {
        slices: [
          { label: 'System prompt', tokens: 4_000 },
          { label: 'Tools', tokens: 6_000 },
          { label: 'Orientation', tokens: 0 },
        ],
        remainderLabel: 'Conversation',
      },
    });

    expect(metrics?.segments).toEqual([
      { label: 'System prompt', tokens: 4_000 },
      { label: 'Tools', tokens: 6_000 },
      { label: 'Conversation', tokens: 47_000 },
    ]);
  });

  test('an attribution wider than the figure states no negative remainder', () => {
    const metrics = chatContextUsageMetrics({
      ...labels,
      source: chatContextSource({ reading: reading({ totalTokens: 1_000 }), live: null }),
      attribution: { slices: [{ label: 'Tools', tokens: 6_000 }], remainderLabel: 'Conversation' },
    });

    expect(metrics?.segments).toEqual([{ label: 'Tools', tokens: 6_000 }]);
  });
});

const WINDOW: ThreadContextLimit = { window: 200_000, compaction: null };
const COMPACTING: ThreadContextLimit = {
  window: 200_000,
  compaction: { at: 110_000, strategy: 'percent', share: 0.55, source: 'override' },
};

const ENGLISH_LABELS = {
  input: 'Input',
  output: 'Output',
  reasoning: 'Reasoning',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  total: 'Total',
};

function reading(
  usage: ConstructorParameters<typeof Usage>[0],
  overrides: Partial<NonNullable<SerializedThread['contextReading']>> = {},
): SerializedThread['contextReading'] {
  return {
    usage: new Usage(usage),
    contextWindow: 200_000,
    runId: 'run-1',
    stepNumber: 3,
    provider: 'subscription',
    model: 'claude-opus-4-8',
    measuredAt: '2026-08-26T10:00:00.000Z',
    stale: false,
    ...overrides,
  };
}

function live(input: Omit<ChatLiveContext, 'runId' | 'provider' | 'model'>): ChatLiveContext {
  return { runId: 'run-1', provider: 'subscription', model: 'claude-sonnet-5', ...input };
}

describe('occupancy is the measured prompt against the thread limit', () => {
  const reading = {
    usage: new Usage({
      inputTokens: 412_185,
      nonCachedInputTokens: 6_297,
      cacheReadInputTokens: 405_888,
      outputTokens: 1_459,
      reasoningTokens: 1_034,
      totalTokens: 413_644,
    }),
    contextWindow: 872_000,
    runId: 'run-1',
    stepNumber: 4,
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    measuredAt: '2026-09-01T00:00:00.000Z',
    stale: false,
  };

  test('the answer the model produced is no part of the prompt it answered', () => {
    const metrics = chatContextUsageMetrics({
      source: chatContextSource({ reading, limit: { window: 872_000, compaction: null } }),
      providerLabel: 'OpenAI OAuth',
      modelLabel: 'GPT-5.6 Sol',
    });

    if (!metrics) throw new Error('a measured reading answers metrics');
    expect(metrics.contextTokens).toBe(412_185);
    expect(metrics.limitTokens).toBe(872_000);
    expect(Math.round(metrics.usagePercent!)).toBe(47);
    expect(metrics.totalTokens).toBe(413_644);
    expect(metrics.outputTokens).toBe(1_459);
  });
});
