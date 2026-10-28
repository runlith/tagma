import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import Frame from './test-utils/nested-eager/Frame.svelte';
import { EagerWorld } from './test-utils/nested-eager/world.svelte.js';

describe('a branch an effect closes, whose teardown flushes', () => {
  it('lets the outer flush finish the blocks it collected', async () => {
    const world = new EagerWorld();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const frame = mount(Frame, { target, props: { world } });
    await flush();
    expect(target.querySelector('[data-testid="branch"]')).not.toBeNull();

    world.closing = true;
    expect(() => flushSync()).not.toThrow();

    expect(target.querySelector('[data-testid="branch"]')).toBeNull();
    expect(world.seen).toBe(1);
    await unmount(frame);
    target.remove();
  });
});
