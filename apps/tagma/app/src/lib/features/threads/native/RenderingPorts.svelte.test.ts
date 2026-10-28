// @vitest-environment jsdom
import type { ChatRewind } from '@runlith/chat-ui/rewind';
import { flush } from '@runlith/testing/flush';
import { mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import { RenderingPorts } from './RenderingPorts.svelte.js';
import RewindClaim, { type RewindWorld } from './RewindClaim.fixture.svelte';

class World implements RewindWorld {
  offered = $state(true);
  port: ChatRewind;
  loads = $state(0);
  readonly failures: unknown[] = [];
  private gate: Promise<void> = Promise.resolve();

  constructor(port: ChatRewind) {
    this.port = $state.raw(port);
  }

  hold(): () => void {
    let release = (): void => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async slow(loads: number): Promise<number> {
    await this.gate;
    return loads;
  }
}

test('a part that gave the rewind port back takes it again while the batch of its release still awaits', async () => {
  const first = {} as ChatRewind;
  const second = {} as ChatRewind;
  const world = new World(first);
  const ports = new RenderingPorts();
  const target = document.createElement('div');
  document.body.appendChild(target);
  const claim = mount(RewindClaim, { target, props: { world, ports } });
  await flush();
  expect(ports.rewind).toBe(first);

  const release = world.hold();
  world.offered = false;
  await flush();
  world.port = second;
  world.offered = true;
  await flush();
  release();
  await flush();

  expect(world.failures).toEqual([]);
  expect(ports.rewind).toBe(second);
  await unmount(claim);
  target.remove();
});
