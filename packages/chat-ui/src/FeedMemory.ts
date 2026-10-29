import type { VirtualItem } from '@tanstack/virtual-core';

export const FEED_MEMORY_THREADS = 8;

export type Disclosure = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

export type MeasuredStamp = {
  readonly width: number;
  readonly estimate: number;
  readonly epoch: string;
};

export type Measured = {
  readonly row: VirtualItem;
  readonly stamp: MeasuredStamp;
};

type ThreadFeed = {
  expanded: Record<string, boolean>;
  measured: readonly Measured[];
};

export class FeedMemory {
  private readonly threads = new Map<string, ThreadFeed>();

  constructor(disclosure: Disclosure = {}) {
    for (const [thread, expanded] of Object.entries(disclosure)) this.threads.set(thread, { expanded: { ...expanded }, measured: [] });
    this.trim();
  }

  expansion(thread: string): Readonly<Record<string, boolean>> {
    return this.threads.get(thread)?.expanded ?? {};
  }

  expand(thread: string, key: string, value: boolean): void {
    this.touch(thread).expanded[key] = value;
    this.trim();
  }

  disclosure(): Disclosure {
    return Object.fromEntries([...this.threads].map(([thread, feed]) => [thread, { ...feed.expanded }]));
  }

  keep(thread: string, measured: readonly Measured[]): void {
    this.touch(thread).measured = measured;
    this.trim();
  }

  measurements(thread: string, fits: (key: string, stamp: MeasuredStamp) => boolean): Measured[] {
    return (this.threads.get(thread)?.measured ?? []).filter((held) => fits(String(held.row.key), held.stamp));
  }

  private touch(thread: string): ThreadFeed {
    const held = this.threads.get(thread) ?? { expanded: {}, measured: [] };
    this.threads.delete(thread);
    this.threads.set(thread, held);
    return held;
  }

  private trim(): void {
    while (this.threads.size > FEED_MEMORY_THREADS) {
      const oldest = this.threads.keys().next().value;
      if (oldest === undefined) return;
      this.threads.delete(oldest);
    }
  }
}
