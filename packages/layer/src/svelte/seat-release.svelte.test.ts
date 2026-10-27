import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import Frame from './test-utils/seat-release/Frame.svelte';
import { SeatWorld } from './test-utils/seat-release/world.svelte.js';

describe('a guard cleared by the teardown of a branch its batch removes', () => {
  it.each([
    ['', false],
    [' when the guarded branch flushes in its own teardown', true],
  ])('keeps the batch from running what that guard held%s', async (_case, settles) => {
    const world = new SeatWorld(settles);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const frame = mount(Frame, { target, props: { world } });
    await flush();
    expect(target.querySelector('[data-testid="row"]')?.className).toBe('on');

    world.open = false;
    world.tick = 1;
    flushSync();

    expect(world.failures).toEqual([]);
    expect(target.querySelector('[data-testid="page"]')).toBeNull();
    expect(target.querySelector('[data-testid="row"]')).toBeNull();
    await unmount(frame);
    target.remove();
  });
});
