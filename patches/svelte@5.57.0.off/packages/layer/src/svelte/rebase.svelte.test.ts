import { flush } from '@runlith/testing/flush';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import Items from './test-utils/rebase/Items.svelte';
import { RebaseWorld } from './test-utils/rebase/world.svelte.js';

describe('an awaiting batch rebased by two later commits', () => {
  it('shows the item value its rebase computed once it commits', async () => {
    const world = new RebaseWorld();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const items = mount(Items, { target, props: { world } });
    await flush();

    const release = world.hold();
    world.a = 1;
    await flush();
    world.b = 1;
    await flush();
    world.c = 1;
    await flush();
    release();
    await flush();

    expect([...target.querySelectorAll('[data-testid="item"]')].map((node) => node.textContent)).toEqual(['item 1']);
    await unmount(items);
    target.remove();
  });
});
