// @vitest-environment jsdom

import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Layer } from '@runlith/layer/Layer';
import { Visitor } from '@runlith/layer/testing';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { flush } from '@runlith/testing/flush';

import { watch } from './test-utils/watch.svelte.js';

import { Dialogs } from './DialogRegistry.svelte.js';
import { Launchers } from './Launchers.svelte.js';
import { makeOverlay } from './testing.js';
import { Overlay, type OverlayKeyClass } from './Overlay.svelte.js';

const First = Overlay.define()('door-laws/first', { as: 'launcher' });
const Second = Overlay.define()('door-laws/second', { as: 'launcher' });
const View = {} as Component<Record<string, never>>;

type DoorVerbs = Pick<Overlay, 'open' | 'close' | 'isOpen' | 'peekOpen' | 'anyOf'>;

type Door = {
  readonly overlay: DoorVerbs;
  readonly settle: () => Promise<void>;
  readonly teardown: () => Promise<void>;
};

const doors: Record<string, () => Door> = {
  'the real door': () => {
    const app = mountApp(Layer.mergeAll(Dialogs, Launchers, Overlay, First.present(View), Second.present(View)), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
    });
    return {
      overlay: app.get(Overlay),
      settle: flush,
      teardown: () => app.unmount(),
    };
  },
  'the published double': () => {
    const stub = makeOverlay({ presentOnOpen: true });
    return {
      overlay: stub.overlay,
      settle: flush,
      teardown: async () => undefined,
    };
  },
};

describe.each(Object.entries(doors))('door laws: %s', (_name, makeDoor) => {
  const KeyFirst = First as OverlayKeyClass<string, Record<string, never>>;
  const KeySecond = Second as OverlayKeyClass<string, Record<string, never>>;

  it('answers isOpen for the whole life of a request, and wakes a watching effect on both edges', async () => {
    const door = makeDoor();
    const seen = watch(() => door.overlay.isOpen(KeyFirst));
    await door.settle();

    door.overlay.open(KeyFirst, {});
    await door.settle();
    expect(door.overlay.isOpen(KeyFirst)).toBe(true);
    expect(door.overlay.peekOpen(KeyFirst)).toBe(true);

    door.overlay.close(KeyFirst);
    await door.settle();
    expect(door.overlay.isOpen(KeyFirst)).toBe(false);

    expect(seen.seen[0]).toBe(false);
    expect(seen.seen).toContain(true);
    expect(seen.seen[seen.seen.length - 1]).toBe(false);

    seen.stop();
    await door.teardown();
  });

  it('keeps one request per key: a repeat open refreshes, never raises a second showing', async () => {
    const door = makeDoor();

    const first = door.overlay.open(KeyFirst, {});
    const again = door.overlay.open(KeyFirst, {});
    await door.settle();

    expect(again.closed).toBe(first.closed);

    door.overlay.close(KeyFirst);
    await door.teardown();
  });

  it('delivers the closing answer to the handle of the key it belongs to', async () => {
    const door = makeDoor();

    const first = door.overlay.open(KeyFirst, {});
    const second = door.overlay.open(KeySecond, {});
    await door.settle();

    door.overlay.close(KeyFirst, 'first-answer');
    door.overlay.close(KeySecond, 'second-answer');

    await expect(first.closed).resolves.toBe('first-answer');
    await expect(second.closed).resolves.toBe('second-answer');

    await door.teardown();
  });

  it('answers one fact over several keys, true while any of them is up, and wakes a watching effect', async () => {
    const door = makeDoor();
    const anyOfThem = door.overlay.anyOf(KeyFirst, KeySecond);
    const seen = watch(() => anyOfThem.current);
    await door.settle();

    expect(anyOfThem.current).toBe(false);

    door.overlay.open(KeyFirst, {});
    door.overlay.open(KeySecond, {});
    await door.settle();
    expect(anyOfThem.current).toBe(true);

    door.overlay.close(KeyFirst);
    await door.settle();
    expect(anyOfThem.current).toBe(true);

    door.overlay.close(KeySecond);
    await door.settle();
    expect(anyOfThem.current).toBe(false);

    expect(seen.seen[0]).toBe(false);
    expect(seen.seen).toContain(true);
    expect(seen.seen[seen.seen.length - 1]).toBe(false);

    seen.stop();
    await door.teardown();
  });

  it('peekOpen answers without waking the asking effect', async () => {
    const door = makeDoor();

    let runs = 0;
    const seen = watch(() => {
      runs += 1;
      return door.overlay.peekOpen(KeyFirst);
    });
    await door.settle();
    const runsBefore = runs;

    door.overlay.open(KeyFirst, {});
    await door.settle();

    expect(door.overlay.peekOpen(KeyFirst)).toBe(true);
    expect(runs).toBe(runsBefore);

    seen.stop();
    door.overlay.close(KeyFirst);
    await door.teardown();
  });
});
