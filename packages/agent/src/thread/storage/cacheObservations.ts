import type { Effect } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';

export type ThreadCacheObservationValues = {
  readonly runId: string;
  readonly stepNumber: number;
  readonly provider: string;
  readonly model: string | null;
  readonly sentAt: string;
  readonly gapMs: number;
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
};

export type ThreadCacheObservation = ThreadCacheObservationValues & {
  readonly threadId: string;
};

export const CACHE_CURVE_SAMPLE = 100;

export interface ThreadCacheObservationStorage<TTx, TWrite extends TTx = TTx> {
  append(threadId: string, values: ThreadCacheObservationValues, tx: TWrite): Effect.Effect<void, ThreadPortFailure>;

  latest(providers: readonly string[], limit: number, tx?: TTx): Effect.Effect<readonly ThreadCacheObservation[], ThreadPortFailure>;
}
