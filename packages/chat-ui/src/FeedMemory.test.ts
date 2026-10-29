import type { VirtualItem } from '@tanstack/virtual-core';
import { describe, expect, test } from 'vitest';
import { FEED_MEMORY_THREADS, FeedMemory, type Measured } from './FeedMemory';

const measured = (key: string): Measured => ({
  row: { key, index: 0, start: 0, end: 40, size: 40, lane: 0 } as VirtualItem,
  stamp: { width: 800, estimate: 40, epoch: '1:16' },
});

describe('what a slot remembers of the threads it showed', () => {
  test('only the threads touched most recently are kept, measurements and expansions together', () => {
    const memory = new FeedMemory();
    for (let index = 0; index <= FEED_MEMORY_THREADS; index += 1) {
      memory.expand(`t${index}`, 'a', true);
      memory.keep(`t${index}`, [measured('a')]);
    }
    const any = () => true;

    expect(memory.measurements('t0', any)).toEqual([]);
    expect(Object.keys(memory.disclosure())).toHaveLength(FEED_MEMORY_THREADS);
    expect(memory.measurements(`t${FEED_MEMORY_THREADS}`, any)).toHaveLength(1);
  });
});
