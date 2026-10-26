import type { ThreadCacheCurveReading } from '@runlith/agent/thread/cache/ThreadCacheCurve';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import type { ModelCatalog } from '@runlith/llm/models/catalog';

export type WarmthBasis = {
  readonly curves: ReadonlyMap<string, ThreadCacheCurveReading>;
  readonly accounts: ReadonlyMap<string, string>;
  readonly models: ModelCatalog;
};

export type WarmthSubject = {
  readonly contextReading: ThreadContextReading | null;
  readonly account: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
};
