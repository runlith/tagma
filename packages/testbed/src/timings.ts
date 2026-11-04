export const TIMINGS = '.bun-test-timings.json';

export const SHARD_TIMINGS = /^\.bun-test-timings\.\d+-of-\d+\.json$/;

export type Timings = { readonly version: 1; readonly files: Readonly<Record<string, number>> };

export const shardOf = (value: string): { readonly index: number; readonly count: number } => {
  const parts = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(parts?.[1]);
  const count = Number(parts?.[2]);
  if (parts === null || index < 1 || index > count) throw new Error(`--shard must be <index>/<count> with 1 <= index <= count: ${value}`);
  return { index, count };
};

export const shardTimings = (value: string): string => {
  const { index, count } = shardOf(value);
  return `.bun-test-timings.${index}-of-${count}.json`;
};
