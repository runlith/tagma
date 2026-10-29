import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount, type Component, type ComponentProps } from 'svelte';
import { describe, expect, it } from 'vitest';

import type { MountedApp } from '../App.js';
import { Visitor } from '../testing.js';
import { gatedEngine, Probe, ProbeGuard, ProbeLateDependency, World } from './test-utils/time-travel/fixtures.svelte.js';
import Host from './test-utils/time-travel/Host.svelte';

type HostProps = ComponentProps<typeof Host>;

function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountHost() {
  const gate = gatedEngine();
  const target = document.createElement('div');
  document.body.appendChild(target);
  let mounted: MountedApp | undefined;
  const state = $state<HostProps>({
    engines: [gate.layer],
    session: Visitor.user('1'),
    open: false,
    twin: false,
    onApp: (app) => {
      mounted = app;
    },
  });
  const host = mount(Host as Component<HostProps>, { target, props: state });
  flushSync();
  await flush();
  state.open = true;
  flushSync();
  const app = (): MountedApp => {
    if (!mounted) throw new Error('the host published no app');
    return mounted;
  };
  return {
    state,
    target,
    gate,
    world: () => app().resolve(World),
    probe: () => app().resolve(Probe),
    late: () => app().resolve(ProbeLateDependency),
    guard: () => app().resolve(ProbeGuard),
    text: (id: string) => [...target.querySelectorAll(`[data-testid="${id}"]`)].map((node) => node.textContent),
    unmount: async () => {
      await unmount(host);
      target.remove();
    },
  };
}

async function respondThenRelease(app: Awaited<ReturnType<typeof mountHost>>): Promise<void> {
  await macrotask();
  app.world().b = 2;
  await flush();
  app.gate.release();
  await flush();
}

describe('an effect outside the tree sees one world · handle', () => {
  it('a response inside the chunk window reaches the effect together with the mount', async () => {
    const app = await mountHost();
    await respondThenRelease(app);

    expect(app.text('found')).toEqual(['hit:book']);
    expect(app.probe().runs.at(-1)).toEqual([1, 2]);
    expect(app.probe().runs).not.toContainEqual([undefined, 2]);
    await app.unmount();
  });

  it('a dependency the effect takes on only with the response is the committed one', async () => {
    const app = await mountHost();
    await respondThenRelease(app);

    expect(app.late().runs.at(-1)).toEqual([1, 2]);
    await app.unmount();
  });

  it('a derived over the held value settles on the committed pair', async () => {
    const app = await mountHost();
    await respondThenRelease(app);

    expect(app.world().ab).toBe('1/2');
    await app.unmount();
  });

  it('a teardown armed by the mount is never run by the response', async () => {
    const app = await mountHost();
    app.guard();
    await respondThenRelease(app);

    expect(app.world().cancelled).toBe(0);
    await app.unmount();
  });

  it('a response that writes the held value merges into the mount instead of undoing it', async () => {
    const app = await mountHost();
    await macrotask();
    app.world().a = 5;
    app.world().b = 2;
    await flush();
    app.gate.release();
    await flush();

    expect(app.probe().runs.at(-1)).toEqual([5, 2]);
    expect(app.text('found')).toEqual(['hit:book']);
    await app.unmount();
  });

  it('a second window opened by a later batch commits whole as well', async () => {
    const app = await mountHost();
    await macrotask();
    app.state.twin = true;
    flushSync();
    await macrotask();
    app.world().b = 2;
    await flush();
    app.gate.release();
    await flush();

    expect(app.text('found')).toEqual(['hit:book', 'hit:book']);
    expect(app.probe().runs.at(-1)).toEqual([1, 2]);
    await app.unmount();
  });

  it('a session change during the window closes the probe, and nothing runs on it afterwards', async () => {
    const app = await mountHost();
    const probe = app.probe();
    await macrotask();
    app.state.session = Visitor.user('2');
    flushSync();
    await flush();
    app.world().b = 2;
    await flush();
    app.gate.release();
    await flush();

    expect(probe.runsAtClose).toBeDefined();
    expect(probe.runs).toHaveLength(probe.runsAtClose ?? -1);
    await app.unmount();
  });
});

describe('a failed chunk', () => {
  it('leaves the world the mount put on screen · handle', async () => {
    const app = await mountHost();
    await macrotask();
    app.world().b = 2;
    await flush();
    app.gate.fail(new Error('chunk 404'));
    await flush();

    expect(app.probe().runs.at(-1)).toEqual([1, 2]);
    expect(app.text('found')).toEqual([]);
    await app.unmount();
  });
});
