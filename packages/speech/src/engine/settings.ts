import { type SegmenterSettings, segmenterDefaults } from './segmenter.ts';
import { type Splitting, splittingDefaults } from './turns.ts';

export type Retry = {
  readonly baseMs: number;
  readonly capMs: number;
  readonly attempts: number;
};

export type Rollover = {
  readonly leadMs: number;
  readonly marginMs: number;
};

export type ListeningSettings = {
  readonly budgetMs: number;
  readonly readyMs: number;
  readonly finishMs: number;
  readonly clipQueueMs: number;
  readonly clipDeadlineMs: number;
  readonly retry: Retry;
  readonly rollover: Rollover;
  readonly segmenter: SegmenterSettings;
  readonly splitting: Splitting;
};

export const listeningDefaults: ListeningSettings = {
  budgetMs: 10_000,
  readyMs: 15_000,
  finishMs: 10_000,
  clipQueueMs: 120_000,
  clipDeadlineMs: 60_000,
  retry: { baseMs: 500, capMs: 30_000, attempts: 5 },
  rollover: { leadMs: 30_000, marginMs: 5_000 },
  segmenter: segmenterDefaults,
  splitting: splittingDefaults,
};

export const backoffMs = (retry: Retry, failures: number, retryAfterMs: number | undefined): number =>
  Math.max(Math.min(retry.capMs, retry.baseMs * 2 ** Math.max(0, failures - 1)), retryAfterMs ?? 0);
