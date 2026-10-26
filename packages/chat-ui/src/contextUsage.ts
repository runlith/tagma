import type { SerializedThread } from '@runlith/agent/protocol/http';
import type { ThreadContextEstimate } from '@runlith/agent/transcript/live';
import { limitTokens, occupiedTokens, type ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';

type ThreadContextReading = NonNullable<SerializedThread['contextReading']>;
type WireUsage = ThreadContextReading['usage'];

export type ChatLiveContext = {
  runId: string;
  provider: string | null;
  model: string | null;
  estimate: ThreadContextEstimate;
};

export type ChatContextUsageReading = 'measured' | 'estimated' | 'unknown' | 'none';

export type ChatContextSource = {
  reading: ChatContextUsageReading;
  contextTokens: number;
  limit: ThreadContextLimit | null;
  usage: WireUsage | null;
  provider: string | null;
  model: string | null;
  nextRequest: { tokens: number } | null;
};

export function chatContextSource(input: {
  reading: SerializedThread['contextReading'];
  live?: ChatLiveContext | null | undefined;
  limit?: ThreadContextLimit | null | undefined;
}): ChatContextSource {
  const reading = input.reading;
  const live = input.live ?? null;
  const limit = input.limit ?? null;
  if (reading === null) {
    if (live === null) {
      return { reading: 'none', contextTokens: 0, limit, usage: null, provider: null, model: null, nextRequest: null };
    }
    return {
      nextRequest: null,
      reading: 'estimated',
      contextTokens: live.estimate.tokens,
      limit,
      usage: null,
      provider: live.provider,
      model: live.model,
    };
  }
  return {
    nextRequest: live === null ? null : { tokens: live.estimate.tokens },
    reading: reading.stale ? 'unknown' : 'measured',
    contextTokens: occupiedTokens(reading.usage) ?? 0,
    limit,
    usage: reading.usage,
    provider: reading.provider,
    model: reading.model,
  };
}

export const CHAT_CONTEXT_SEGMENT_STEPS = ['bg-foreground/80', 'bg-foreground/55', 'bg-foreground/40', 'bg-foreground/25'] as const;

export type ChatContextSlice = {
  label: string;
  tokens: number;
};

export type ChatContextAttribution = {
  slices: readonly ChatContextSlice[];
  remainderLabel: string;
};

export type ChatContextUsageMetrics = {
  providerLabel: string;
  modelLabel: string;
  reading: ChatContextUsageReading;
  contextTokens: number;
  limit?: ThreadContextLimit;
  limitTokens?: number;
  usagePercent?: number;
  tokensRemaining?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  totalTokens?: number;
  nonCachedInputTokens?: number;
  visibleOutputTokens?: number;
  segments?: readonly ChatContextSlice[];
  nextRequestTokens?: number;
};

export type ChatContextUsageDetailRow = {
  label: string;
  value: string;
};

export type ChatContextUsageLabels = {
  input: string;
  output: string;
  reasoning: string;
  cacheRead: string;
  cacheWrite: string;
  total: string;
};

export function chatContextUsageMetrics(input: {
  source: ChatContextSource;
  providerLabel: string;
  modelLabel: string;
  attribution?: ChatContextAttribution | undefined;
}): ChatContextUsageMetrics | null {
  const source = input.source;
  const limit = source.limit ?? undefined;
  const ceiling = limit === undefined || limitTokens(limit) <= 0 ? undefined : limitTokens(limit);
  if (source.reading === 'none' && ceiling === undefined) return null;
  const usage = source.usage;
  const nonCachedInputTokens =
    usage?.nonCachedInputTokens ??
    (usage?.inputTokens === undefined
      ? undefined
      : Math.max(0, usage.inputTokens - (usage.cacheReadInputTokens ?? 0) - (usage.cacheWriteInputTokens ?? 0)));
  const visibleOutputTokens =
    usage?.outputTokens === undefined ? undefined : Math.max(0, usage.outputTokens - (usage.reasoningTokens ?? 0));
  return {
    providerLabel: input.providerLabel,
    modelLabel: input.modelLabel,
    reading: source.reading,
    contextTokens: source.contextTokens,
    limit,
    limitTokens: ceiling,
    usagePercent:
      ceiling === undefined || source.reading === 'unknown'
        ? undefined
        : Math.min(100, Math.max(0, (source.contextTokens / ceiling) * 100)),
    tokensRemaining: ceiling === undefined || source.reading === 'unknown' ? undefined : Math.max(ceiling - source.contextTokens, 0),
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    reasoningTokens: usage?.reasoningTokens,
    cacheReadInputTokens: usage?.cacheReadInputTokens,
    cacheWriteInputTokens: usage?.cacheWriteInputTokens,
    totalTokens: usage?.totalTokens,
    nonCachedInputTokens,
    visibleOutputTokens,
    segments: input.attribution === undefined ? undefined : attributed(input.attribution, source.contextTokens),
    nextRequestTokens: source.nextRequest === null ? undefined : source.nextRequest.tokens,
  };
}

function attributed(attribution: ChatContextAttribution, contextTokens: number): readonly ChatContextSlice[] {
  const named = attribution.slices.reduce((sum, slice) => sum + slice.tokens, 0);
  const remainder = Math.max(0, contextTokens - named);
  return [...attribution.slices, { label: attribution.remainderLabel, tokens: remainder }].filter((slice) => slice.tokens > 0);
}

export function formatContextTokens(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatContextPercent(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
    (value >= 10 ? Math.round(value) : value) / 100,
  );
}

export function chatContextUsageDetailRows(
  metrics: ChatContextUsageMetrics,
  locale: string,
  labels: ChatContextUsageLabels,
): readonly ChatContextUsageDetailRow[] {
  const rows: ChatContextUsageDetailRow[] = [];

  addUsageRow(rows, labels.input, metrics.nonCachedInputTokens, locale);
  addUsageRow(rows, labels.output, metrics.visibleOutputTokens, locale);
  addUsageRow(rows, labels.reasoning, metrics.reasoningTokens, locale);
  addUsageRow(rows, labels.cacheRead, metrics.cacheReadInputTokens, locale);
  addUsageRow(rows, labels.cacheWrite, metrics.cacheWriteInputTokens, locale);
  addUsageRow(rows, labels.total, metrics.totalTokens, locale);

  return rows;
}

function addUsageRow(rows: ChatContextUsageDetailRow[], label: string, value: number | undefined, locale: string): void {
  if (value === undefined) return;
  rows.push({ label, value: formatContextTokens(value, locale) });
}
