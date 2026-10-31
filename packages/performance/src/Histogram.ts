import type { MetricPercentile } from './protocol/reports.js';

export type HistogramCounts = {
  readonly boundariesMs: ReadonlyArray<number>;
  readonly bucketCounts: ReadonlyArray<number>;
  readonly count: number;
};

export function metricPercentile(total: HistogramCounts, quantile: number): MetricPercentile {
  const rank = Math.ceil(total.count * quantile);
  let accumulated = 0;
  for (let index = 0; index < total.boundariesMs.length; index += 1) {
    accumulated += total.bucketCounts[index]!;
    if (accumulated < rank) continue;
    return { upperBoundMs: total.boundariesMs[index]! };
  }
  return { aboveMs: total.boundariesMs[total.boundariesMs.length - 1]! };
}
