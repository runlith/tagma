import { describe, expect, test } from 'bun:test';
import type { ThreadHistory } from '@runlith/agent/thread/rows';
import { UnitEnd } from '../../platform/store/life.js';
import { HeldHistories } from './heldHistories.js';
import { GuidanceIndex } from './guidanceIndex.js';

const standing = (doc: ThreadHistory, cursor: number) => ({
  stored: doc,
  cursor,
  through: cursor,
  guidance: new GuidanceIndex().append(doc),
});

const unit = () => {
  const end = new UnitEnd();
  return { end, unit: end.bind({}) };
};

describe('HeldHistories', () => {
  const weighed = (live: HeldHistories, bytes = 100): ThreadHistory => {
    const doc = [{ role: 'user', content: [] }] as unknown as ThreadHistory;
    live.weigh(doc[0]!, bytes);
    return doc;
  };

  test('a published history survives collection between callers', async () => {
    const live = new HeldHistories();
    const publish = () => {
      const doc = weighed(live);
      live.settle(live.claim('t', {}), doc, standing(doc, 1));
    };
    publish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    Bun.gc(true);
    expect(live.held('t')?.history).toHaveLength(1);
  });

  test('the resident bound evicts the least recently read history and releases replaced weights', () => {
    const live = new HeldHistories(2 * (120 + 160));
    const keep = (id: string) => {
      const next = weighed(live, 100);
      live.settle(live.claim(id, {}), next, standing(next, 1));
      return next;
    };
    const one = keep('one');
    keep('two');
    expect(live.held('one')?.history).toBe(one);
    keep('three');
    expect(live.held('two')).toBeNull();
    expect(live.held('one')?.history).toBe(one);
    const again = keep('one');
    expect(live.held('three')).not.toBeNull();
    expect(live.held('one')?.history).toBe(again);
  });

  test('a history is held only while its whole weight fits the bound', () => {
    const live = new HeldHistories(2 * (120 + 160));
    const first = weighed(live);
    live.settle(live.claim('t', {}), first, standing(first, 1));
    const second = [...first, ...weighed(live)];
    live.settle(live.claim('t', {}), second, standing(second, 2));
    expect(live.held('t')?.history).toBe(second);
    const third = [...second, ...weighed(live)];
    live.settle(live.claim('t', {}), third, standing(third, 3));
    expect(live.held('t')).toBeNull();
  });

  test('a message measured again after it was held leaves the bound as it entered it', () => {
    const live = new HeldHistories(2 * (120 + 160));
    const doc = weighed(live, 100);
    live.settle(live.claim('t', {}), doc, standing(doc, 1));
    live.weigh(doc[0]!, 10_000);
    const emptied: ThreadHistory = [];
    live.settle(live.claim('t', {}), emptied, standing(emptied, 2));
    for (const id of ['u', 'v', 'w']) {
      const next = weighed(live, 100);
      live.settle(live.claim(id, {}), next, standing(next, 1));
    }
    expect(live.held('u')).toBeNull();
    expect(live.held('w')).not.toBeNull();
  });

  test('a settled claim answers the history with the cursor it stands at', () => {
    const live = new HeldHistories();
    const doc = weighed(live);
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
    const stale = weighed(live);
    live.settle(early, stale, standing(stale, 1));
    expect(live.held('t')).toBeNull();
    const fresh = weighed(live);
    live.settle(late, fresh, standing(fresh, 2));
    live.settle(early, stale, standing(stale, 1));
    expect(live.held('t')?.history).toBe(fresh);
  });

  test('a claim hides what stood until its writer settles, and marks what a reader held as no longer current', () => {
    const live = new HeldHistories();
    const doc = weighed(live);
    live.settle(live.claim('t', {}), doc, standing(doc, 3));
    const held = live.held('t');
    live.claim('t', {});
    expect(live.held('t')).toBeNull();
    expect(held !== null && live.current('t', held.entry)).toBe(false);
  });

  test('a claim whose unit ends without settling stops hiding the thread from readers', () => {
    const live = new HeldHistories();
    const writer = unit();
    live.claim('t', writer.unit);
    const blocked = live.glimpse('t', {});
    const read = weighed(live);
    live.offer('t', blocked, read, standing(read, 1));
    expect(live.held('t')).toBeNull();
    writer.end.close();
    live.offer('t', live.glimpse('t', {}), read, standing(read, 1));
    expect(live.held('t')?.history).toBe(read);
  });

  test('a reader publishes what it read only when no writer claimed the thread since it looked', () => {
    const live = new HeldHistories();
    const read = weighed(live);
    live.offer('t', live.glimpse('t', {}), read, standing(read, 4));
    expect(live.held('t')?.history).toBe(read);

    const seen = live.glimpse('u', {});
    const written = weighed(live);
    live.settle(live.claim('u', {}), written, standing(written, 5));
    const late = weighed(live);
    live.offer('u', seen, late, standing(late, 4));
    expect(live.held('u')?.history).toBe(written);
  });

  test('a reader that looked while a writer was in flight publishes nothing, even once that writer has settled', () => {
    const live = new HeldHistories();
    const writer = live.claim('t', {});
    const seen = live.glimpse('t', {});
    const early = weighed(live);
    live.offer('t', seen, early, standing(early, 1));
    expect(live.held('t')).toBeNull();
    const written = weighed(live);
    live.settle(writer, written, standing(written, 2));
    live.offer('t', seen, early, standing(early, 1));
    expect(live.held('t')?.history).toBe(written);
  });
});
