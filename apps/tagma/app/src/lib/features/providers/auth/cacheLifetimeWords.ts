import type { ProviderCacheLifetime } from '@tagma/server/providers/contract/wire/accounts';

const WARM = 0.9;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const REACH: Record<ProviderCacheLifetime['buckets'][number]['gap'], string> = {
  '<1m': '1 min',
  '1–5m': '5 min',
  '5–15m': '15 min',
  '15–30m': '30 min',
  '30–60m': '60 min',
  '1–2h': '2 h',
  '>2h': 'beyond 2 h',
};

function promiseWords(seconds: number | null): string {
  if (seconds === null) return 'no promise';
  if (seconds % 3_600 === 0) return `promised ${seconds / 3_600} h`;
  return `promised ${Math.round(seconds / 60)} min`;
}

function bucketWords(gap: string): string {
  return gap.replace('m', ' min').replace('h', ' h');
}

function priorWords(measuredAt: string | null): string {
  if (measuredAt === null) return 'prior';
  const date = new Date(measuredAt);
  return Number.isNaN(date.getTime()) ? 'prior' : `prior, ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function cacheLifetimeLine(entry: ProviderCacheLifetime): string {
  const figured = entry.buckets.filter((bucket) => bucket.warmShare !== null && bucket.source !== null);
  if (figured.length === 0) return `${promiseWords(entry.promisedSeconds)} · not measured`;
  const held: string[] = [];
  let reach: string | null = null;
  let floor = 1;
  let fell: string | null = null;
  for (const bucket of entry.buckets) {
    if (bucket.warmShare === null || bucket.source === null) continue;
    if (fell === null && bucket.warmShare >= WARM) {
      reach = REACH[bucket.gap];
      floor = Math.min(floor, bucket.warmShare);
    } else if (fell === null) {
      fell = `${Math.round(bucket.warmShare * 100)}% at ${bucketWords(bucket.gap)}`;
    }
  }
  if (reach !== null) held.push(`${Math.round(floor * 100)}% warm to ${reach}`);
  if (fell !== null) held.push(fell);
  const sources = new Set(figured.map((bucket) => bucket.source));
  const whose =
    sources.has('local') && sources.has('prior')
      ? 'your data · prior'
      : sources.has('local')
        ? 'your data'
        : priorWords(entry.priorMeasuredAt);
  return `${promiseWords(entry.promisedSeconds)} · measured: ${held.join(', ')} · ${whose}`;
}

export function cacheLifetimeBuckets(entry: ProviderCacheLifetime): string {
  return entry.buckets
    .map((bucket) =>
      bucket.warmShare === null
        ? `${bucket.gap} — (${bucket.sample})`
        : `${bucket.gap} ${Math.round(bucket.warmShare * 100)}% (${bucket.sample}, ${bucket.source === 'local' ? 'your data' : 'prior'})`,
    )
    .join('\n');
}
