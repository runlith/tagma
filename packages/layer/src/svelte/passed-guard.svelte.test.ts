import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import Frame from './test-utils/passed-guard/Frame.svelte';
import Revisit from './test-utils/passed-guard/Revisit.svelte';
import { GuardWorld } from './test-utils/passed-guard/world.svelte.js';

describe('a guard the traversal passed, cleared by the teardown of a later branch', () => {
  it('keeps the batch from running the effects that guard held', async () => {
    const world = new GuardWorld();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const frame = mount(Frame, { target, props: { world } });
    await flush();
    expect(target.querySelector('[data-testid="handle"]')?.textContent).toBe('1');

    world.grip = { size: 2 };
    world.holding = false;
    flushSync();

    expect(world.failures).toEqual([]);
    expect(target.querySelector('[data-testid="holder"]')).toBeNull();
    expect(target.querySelector('[data-testid="handle"]')).toBeNull();
    await unmount(frame);
    target.remove();
  });

  it('updates that guard again when a block run after it clears the guard once more', async () => {
    const world = new GuardWorld();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const frame = mount(Revisit, { target, props: { world } });
    await flush();
    expect(target.querySelector('[data-testid="handle"]')?.textContent).toBe('1');

    world.grip = { size: 2 };
    world.third = false;
    flushSync();

    expect(world.failures).toEqual([]);
    expect(target.querySelector('[data-testid="holder"]')).toBeNull();
    expect(target.querySelector('[data-testid="handle"]')).toBeNull();
    await unmount(frame);
    target.remove();
  });
});
