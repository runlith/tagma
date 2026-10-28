import { flush } from '@runlith/testing/flush';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import Frame from './test-utils/branch-removal/Frame.svelte';
import { BranchWorld } from './test-utils/branch-removal/world.svelte.js';

describe('a branch an awaiting batch removes', () => {
  it('runs nothing in a later batch that carries that batch', async () => {
    const world = new BranchWorld();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const frame = mount(Frame, { target, props: { world } });
    await flush();

    const release = world.hold();
    world.slot = null;
    world.other = 1;
    await flush();
    world.other = 2;
    world.tick = 1;
    await flush();
    release();
    await flush();

    expect(world.failures).toEqual([]);
    expect(target.querySelector('[data-testid="row"]')).toBeNull();
    await unmount(frame);
    target.remove();
  });
});
