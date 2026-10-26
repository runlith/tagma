import { Data, Effect } from 'effect';
import { RAW_CHARS_PER_TOKEN, type ThreadTokenEstimate } from './measurement';

export class ThreadCalibrationSaveFailed extends Data.TaggedError('ThreadCalibrationSaveFailed')<{ readonly cause: unknown }> {}

export type ThreadCalibrationProfileStore = {
  load(): Record<string, number> | undefined;
  save(weights: Record<string, number>): Effect.Effect<void, ThreadCalibrationSaveFailed>;
};

export type ThreadCalibrationBaseline = (provider: string, model: string | null) => number | undefined;

const MINIMUM_WEIGHT = 0.5;
const MAXIMUM_WEIGHT = 2;

export class ThreadTokenCalibration {
  private weights = new Map<string, number>();
  private dirty = false;
  private readonly store: ThreadCalibrationProfileStore | undefined;
  private readonly baseline: ThreadCalibrationBaseline | undefined;

  constructor(options: { store?: ThreadCalibrationProfileStore; baseline?: ThreadCalibrationBaseline } = {}) {
    this.store = options.store;
    this.baseline = options.baseline;
    const stored = options.store?.load();
    if (stored) {
      for (const [key, weight] of Object.entries(stored)) {
        if (withinBounds(weight)) this.weights.set(key, weight);
      }
      this.dirty = true;
    }
  }

  observe(provider: string, model: string | null, rawEstimatedTokens: number, reportedTokens: number): void {
    if (rawEstimatedTokens <= 0 || reportedTokens <= 0) return;
    const key = this.key(provider, model);
    const oldWeight = this.weight(provider, model);
    const target = Math.max(oldWeight * 0.5, Math.min(reportedTokens / rawEstimatedTokens, oldWeight * 2));
    let next = oldWeight * 0.8 + target * 0.2;
    if (next > oldWeight + 0.15) next = oldWeight + 0.15;
    if (next < oldWeight - 0.15) next = oldWeight - 0.15;
    this.weights.set(key, Math.max(MINIMUM_WEIGHT, Math.min(next, MAXIMUM_WEIGHT)));
    this.dirty = true;
  }

  persist(): Effect.Effect<void, ThreadCalibrationSaveFailed> {
    return Effect.suspend(() => {
      if (this.store === undefined || !this.dirty) return Effect.void;
      this.dirty = false;
      return this.store.save(Object.fromEntries(this.weights)).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            this.dirty = true;
          }),
        ),
      );
    });
  }

  charsPerToken(provider: string, model: string | null): number {
    return RAW_CHARS_PER_TOKEN / this.weight(provider, model);
  }

  weight(provider: string, model: string | null): number {
    const learned = this.weights.get(this.key(provider, model));
    if (learned !== undefined) return learned;
    const measured = this.baseline?.(provider, model);
    return measured !== undefined && withinBounds(measured) ? measured : 1;
  }

  private key(provider: string, model: string | null): string {
    return `${provider}/${model ?? ''}`;
  }
}

export function measuredWeight(estimate: ThreadTokenEstimate): number | null {
  if (estimate.measured <= 0 || estimate.covered <= 0) return null;
  return Math.max(MINIMUM_WEIGHT, Math.min(estimate.measured / estimate.covered, MAXIMUM_WEIGHT));
}

function withinBounds(weight: number): boolean {
  return weight >= MINIMUM_WEIGHT && weight <= MAXIMUM_WEIGHT;
}
