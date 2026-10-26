import type { VirtualItem } from '@tanstack/virtual-core';
import { describe, expect, test } from 'vitest';
import { FEED_MEMORY_THREADS, FeedMemory, type Measured } from './FeedMemory';

const measured = (key: string, width = 800, open = false): Measured => ({
  row: { key, index: 0, start: 0, end: 40, size: 40, lane: 0 } as VirtualItem,
  stamp: { width, open },
});

const keys = (rows: readonly Measured[]) => rows.map((held) => String(held.row.key));

describe('what a slot remembers of the threads it showed', () => {
  test('a measurement comes back only if it still fits the width and the disclosure it was taken under', () => {
    const memory = new FeedMemory();
    memory.keep('t1', [measured('narrow', 640), measured('wide', 800), measured('opened', 800, true)]);

    const fits = (key: string, stamp: { width: number; open: boolean }) => stamp.width === 800 && stamp.open === (key === 'opened');

    expect(keys(memory.measurements('t1', fits))).toEqual(['wide', 'opened']);
    expect(memory.measurements('t2', fits)).toEqual([]);
  });

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
