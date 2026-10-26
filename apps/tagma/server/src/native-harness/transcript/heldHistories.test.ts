import { describe, expect, test } from 'bun:test';
import type { ThreadHistory } from '@runlith/agent/thread/rows';
import { HeldHistories } from './heldHistories.js';
import { GuidanceIndex } from './guidanceIndex.js';

const history = (): ThreadHistory => [{ role: 'user', content: [] }] as unknown as ThreadHistory;
const standing = (doc: ThreadHistory, cursor: number) => ({
  stored: doc,
  cursor,
  through: cursor,
  guidance: new GuidanceIndex().append(doc),
});

describe('HeldHistories', () => {
  test('a published history survives collection between callers', async () => {
    const live = new HeldHistories();
    const publish = () => {
      const doc = history();
      live.settle(live.claim('t', {}), doc, standing(doc, 1));
    };
    publish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    Bun.gc(true);
    expect(live.held('t')?.history).toEqual(history());
  });

  test('the byte budget evicts the least recently read history and releases replaced weights', () => {
    const doc = history();
    const bytes = JSON.stringify(doc[0]).length * 2;
    const live = new HeldHistories(bytes * 2);
    const keep = (id: string) => {
      const next = history();
      live.settle(live.claim(id, {}), next, standing(next, 1));
    };
    keep('one');
    keep('two');
    expect(live.held('one')?.history).toEqual(doc);
    keep('three');
    expect(live.held('two')).toBeNull();
    expect(live.held('one')?.history).toEqual(doc);
    keep('one');
    expect(live.held('three')?.history).toEqual(doc);
  });

  test('a settled claim answers the history with the cursor it stands at', () => {
    const live = new HeldHistories();
    const doc = history();
    live.settle(live.claim('t', {}), doc, standing(doc, 7));
    const held = live.held('t');
    expect(held?.history).toBe(doc);
    expect(held?.standing).toEqual(standing(doc, 7));
    expect(held !== null && live.current('t', held.entry)).toBe(true);
  });

  test('a writer that settles after a later writer claimed publishes nothing', () => {
    const live = new HeldHistories();
    const early = live.claim('t', {});
    const late = live.claim('t', {});
    const stale = history();
    live.settle(early, stale, standing(stale, 1));
    expect(live.held('t')).toBeNull();
    const fresh = history();
    live.settle(late, fresh, standing(fresh, 2));
    live.settle(early, stale, standing(stale, 1));
    expect(live.held('t')?.history).toBe(fresh);
  });

  test('a claim hides what stood until its writer settles, and marks what a reader held as no longer current', () => {
    const live = new HeldHistories();
    const doc = history();
    live.settle(live.claim('t', {}), doc, standing(doc, 3));
    const held = live.held('t');
    live.claim('t', {});
    expect(live.held('t')).toBeNull();
    expect(held !== null && live.current('t', held.entry)).toBe(false);
  });

  test('a reader publishes what it read only when no writer claimed the thread since it looked', () => {
    const live = new HeldHistories();
    const read = history();
    live.offer('t', live.glimpse('t'), read, standing(read, 4));
    expect(live.held('t')?.history).toBe(read);

    const seen = live.glimpse('u');
    const written = history();
    live.settle(live.claim('u', {}), written, standing(written, 5));
    live.offer('u', seen, history(), standing(history(), 4));
    expect(live.held('u')?.history).toBe(written);
  });

  test('a reader that looked while a writer was in flight publishes nothing, even once that writer has settled', () => {
    const live = new HeldHistories();
    const writer = live.claim('t', {});
    const seen = live.glimpse('t');
    live.offer('t', seen, history(), standing(history(), 1));
    expect(live.held('t')).toBeNull();
    const written = history();
    live.settle(writer, written, standing(written, 2));
    live.offer('t', seen, history(), standing(history(), 1));
    expect(live.held('t')?.history).toBe(written);
  });
});
