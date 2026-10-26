import { heapStats } from 'bun:jsc';
import type { ThreadMemory } from './protocol/records.js';

type Counter = { readonly current: number; readonly peak: number };
type AllocatorStats = {
  readonly process: { readonly rss_current: number; readonly rss_peak: number; readonly page_faults: number };
  readonly reserved: Counter;
  readonly committed: Counter;
  readonly purged: number;
  readonly pages_abandoned: Counter;
};

const isCounter = (value: unknown): value is Counter =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Counter).current === 'number' &&
  typeof (value as Counter).peak === 'number';

const allocatorOf = (stats: unknown): AllocatorStats | undefined => {
  const found = (stats as { readonly mimalloc?: unknown }).mimalloc as AllocatorStats | undefined;
  if (found === undefined || typeof found !== 'object') return undefined;
  const process = found.process as AllocatorStats['process'] | undefined;
  if (process === undefined || typeof process.rss_current !== 'number') return undefined;
  return isCounter(found.reserved) && isCounter(found.committed) && isCounter(found.pages_abandoned) ? found : undefined;
};

const counts = (record: Record<string, number>, take: number | 'all'): ThreadMemory['largestTypes'] => {
  const ranked = Object.entries(record).sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1));
  return (take === 'all' ? ranked : ranked.slice(0, take)).map(([name, count]) => ({ name, count }));
};

export function takeMemoryReading(thread: string, types: number | 'all' = 12): ThreadMemory {
  const censusStart = performance.now();
  const stats = heapStats();
  const censusMs = performance.now() - censusStart;
  const allocator = allocatorOf(stats);
  const usage = process.memoryUsage();
  return {
    thread,
    censusMs,
    process: {
      rssBytes: usage.rss,
      heapTotalBytes: usage.heapTotal,
      heapUsedBytes: usage.heapUsed,
      externalBytes: usage.external,
      arrayBufferBytes: usage.arrayBuffers,
    },
    heap: {
      sizeBytes: stats.heapSize,
      capacityBytes: stats.heapCapacity,
      extraMemoryBytes: stats.extraMemorySize,
      objectCount: stats.objectCount,
      protectedObjectCount: stats.protectedObjectCount,
    },
    allocator:
      allocator === undefined
        ? undefined
        : {
            reservedBytes: allocator.reserved.current,
            committedBytes: allocator.committed.current,
            committedPeakBytes: allocator.committed.peak,
            rssBytes: allocator.process.rss_current,
            rssPeakBytes: allocator.process.rss_peak,
            purgedBytes: allocator.purged,
            abandonedPages: allocator.pages_abandoned.current,
            pageFaults: allocator.process.page_faults,
          },
    largestTypes: counts(stats.objectTypeCounts, types),
  };
}
