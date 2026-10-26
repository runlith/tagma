import { Schema } from 'effect';
import { CACHE_GAP_BUCKETS, type ModelCacheLifetime, cacheGapBucket } from '@runlith/llm/models/cacheLifetime';
import { callRung } from '@runlith/llm/models/resolve';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { ThreadContextReading } from '../rows';
import type { ThreadCacheCurveReading } from './ThreadCacheCurve';

export const CACHE_CURVE_FLOOR = 20;
export const CACHE_WARM_LIKELIHOOD = 0.9;
export const CACHE_LIKELY_LIKELIHOOD = 0.5;

export const ThreadCacheWarmth = Schema.Struct({
  state: Schema.Literals(['warm', 'likely', 'cold', 'unknown']),
  heldTokens: Schema.NullOr(Schema.Number),
  basis: Schema.Literals(['promise', 'local', 'prior', 'none']),
  expiresAt: Schema.NullOr(Schema.String),
  gap: Schema.NullOr(Schema.Literals(CACHE_GAP_BUCKETS.map((bucket) => bucket.gap))),
  warmShare: Schema.NullOr(Schema.Number),
  sample: Schema.NullOr(Schema.Number),
  oldestAt: Schema.NullOr(Schema.String),
  invalidatedBy: Schema.NullOr(Schema.Literals(['compaction', 'rewind', 'selection', 'account', 'reasoning'])),
});
export type ThreadCacheWarmth = typeof ThreadCacheWarmth.Type;

export type ThreadCacheWarmthInput = {
  readonly reading: ThreadContextReading | null;
  readonly selection: {
    readonly provider: string;
    readonly model: string | null;
    readonly account: string | null;
    readonly reasoning?: string | null;
  };
  readonly lifetime: ModelCacheLifetime;
  readonly curve: ThreadCacheCurveReading | null;
  readonly now: number;
};

const NOTHING: ThreadCacheWarmth = {
  state: 'unknown',
  heldTokens: null,
  basis: 'none',
  expiresAt: null,
  gap: null,
  warmShare: null,
  sample: null,
  oldestAt: null,
  invalidatedBy: null,
};

export function threadCacheWarmth({ reading, selection, lifetime, curve, now }: ThreadCacheWarmthInput): ThreadCacheWarmth {
  if (reading === null) return NOTHING;
  const held = { ...NOTHING, heldTokens: reading.usage.inputTokens ?? null };
  if (reading.stale) return { ...held, state: 'cold', invalidatedBy: reading.staleBy ?? 'compaction' };
  if (reading.provider !== selection.provider || reading.model !== selection.model) {
    return { ...held, state: 'cold', invalidatedBy: 'selection' };
  }
  if (reading.account !== undefined && selection.account !== null && reading.account !== selection.account) {
    return { ...held, state: 'cold', invalidatedBy: 'account' };
  }
  if (
    lifetime.reasoningKeyed === true &&
    reading.reasoning !== undefined &&
    selection.reasoning !== undefined &&
    reading.reasoning !== selection.reasoning
  ) {
    return { ...held, state: 'cold', invalidatedBy: 'reasoning' };
  }
  const measuredAt = Date.parse(reading.measuredAt);
  if (!Number.isFinite(measuredAt)) return held;
  const ttlSeconds = reading.cache?.ttlSeconds ?? null;
  if (ttlSeconds !== null) {
    const sentAt = reading.sentAt === undefined ? Number.NaN : Date.parse(reading.sentAt);
    const expiresAt = (Number.isFinite(sentAt) ? Math.min(sentAt, measuredAt) : measuredAt) + ttlSeconds * 1_000;
    return { ...held, state: now < expiresAt ? 'warm' : 'cold', basis: 'promise', expiresAt: new Date(expiresAt).toISOString() };
  }
  const gap = cacheGapBucket(Math.max(0, now - measuredAt));
  const local = curve?.buckets.find((bucket) => bucket.gap === gap);
  if (local !== undefined && local.warmShare !== null && local.sample >= CACHE_CURVE_FLOOR) {
    return {
      ...held,
      state: stateOf(local.warmShare),
      basis: 'local',
      gap,
      warmShare: local.warmShare,
      sample: local.sample,
      oldestAt: local.oldestAt,
    };
  }
  const prior = lifetime.prior?.buckets.find((bucket) => bucket.gap === gap);
  if (prior !== undefined && lifetime.prior !== null) {
    return {
      ...held,
      state: stateOf(prior.warmShare),
      basis: 'prior',
      gap,
      warmShare: prior.warmShare,
      sample: prior.sample,
      oldestAt: lifetime.prior.measuredAt,
    };
  }
  return held;
}

export type ThreadNextRequest = {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly account: string | null;
};

const UNDECLARED_LIFETIME: ModelCacheLifetime = { promisedSeconds: null, prior: null };

export type RequestDeployment = {
  readonly model: string | null;
  readonly lifetime: ModelCacheLifetime;
  readonly rung: string | null | undefined;
};

export function requestDeployment(
  models: ModelCatalog,
  request: { readonly provider: string; readonly model: string | null; readonly reasoning: string | null },
): RequestDeployment {
  try {
    const resolved = models.resolveTextModel(request.provider, request.model);
    return { model: resolved.id, lifetime: resolved.cacheLifetime, rung: callRung(resolved, request.reasoning) };
  } catch {
    return { model: request.model, lifetime: UNDECLARED_LIFETIME, rung: undefined };
  }
}

export function nextRequestWarmth(input: {
  readonly reading: ThreadContextReading;
  readonly next: ThreadNextRequest;
  readonly models: ModelCatalog;
  readonly curve: ThreadCacheCurveReading | null;
  readonly now: number;
}): ThreadCacheWarmth {
  const { provider, account } = input.next;
  const deployment = requestDeployment(input.models, input.next);
  return threadCacheWarmth({
    reading: input.reading,
    selection: {
      provider,
      model: deployment.model,
      account,
      reasoning: deployment.rung,
    },
    lifetime: deployment.lifetime,
    curve: input.curve,
    now: input.now,
  });
}

function stateOf(warmShare: number): ThreadCacheWarmth['state'] {
  return warmShare >= CACHE_WARM_LIKELIHOOD ? 'warm' : warmShare >= CACHE_LIKELY_LIKELIHOOD ? 'likely' : 'cold';
}
