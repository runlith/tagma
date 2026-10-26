// @vitest-environment jsdom
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import { PathRoads } from '$lib/features/checkout/PathRoads.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { EXECUTION_SETTING_KEYS as SETTING_KEYS } from '@tagma/server/executions/settings';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { Graph } from '@runlith/layer/Graph';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { mount, tick, unmount } from 'svelte';
import { expect, test, vi } from 'vitest';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ProjectDoor } from '$lib/features/workspace/ProjectDoor.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { TerminalAppearance } from '$lib/features/executions/appearance/Settings.svelte.js';
import TerminalPaneHost from '$lib/features/executions/terminal/PaneHost.svelte';
import type { TerminalPane } from '$lib/features/executions/terminal/Pane.svelte.js';
import { TerminalKeymap } from '$lib/features/executions/terminal/Keymap.js';
import { TerminalOutput, pageHidden, pageTime } from '$lib/features/executions/terminal/Output.js';
import { TerminalRenderPolicy } from '$lib/features/executions/terminal/RenderPolicy.js';
import { TerminalHolders } from '$lib/features/executions/terminal/Holders.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
import { TerminalViews, type ViewBirth } from './Views.svelte.js';

const HELD = 6;

const birth = (execution: string): ViewBirth => ({
  projectId: 1,
  root: '/root',
  address: { execution, incarnation: 0 },
  program: '/usr/bin/claude',
});

function stand() {
  const repo = {
    record: { key: () => ({ refresh: async () => undefined }) },
    bytes: { key: () => ({ refresh: async () => ({ bytes: '', nextOffset: '0', eof: true }) }) },
    input: { run: async () => undefined },
    laneClose: { run: async () => ({ closed: true }) },
    stop: { run: async () => undefined },
  };
  let panes!: TerminalViews;
  const scope = Scope.make('thread-panes-test');
  const app = Scope.make('thread-panes-app');
  const stop = $effect.root(() => {
    const graph = new Graph(
      Layer.mergeAll(
        Layer.of(ExecutionsRepo, repo as never),
        Layer.of(TerminalRenderPolicy, {
          resume: () => undefined,
          suspend: () => undefined,
          scheduleReveal: () => undefined,
          join: () => () => undefined,
          forget: () => undefined,
          joinPage: () => undefined,
          leavePage: () => undefined,
          hide: () => undefined,
          unhide: () => undefined,
        } as never),
        Layer.of(TerminalAppearance, {
          activeTab: null,
          paneBackground: '#000',
          paneStyle: () => ({}),
          options: () => ({}),
          theme: () => ({}),
          register: () => () => undefined,
          ligaturesOn: () => false,
        } as never),
        Layer.of(TerminalHolders, new TerminalHolders(() => [], ThreadNames.make())),
        Layer.of(Notices, { error: () => undefined, refusal: () => undefined } as never),
        Layer.of(Host, new Host('tab', 'linux')),
        Layer.of(FileOpener, { open: () => Promise.resolve(), stage: () => () => undefined, stand: () => () => undefined } as never),
        Layer.of(PathRoads, { road: () => async () => null } as never),
        Layer.of(Opening, {
          open: () => {
            throw new Error('links are not part of this case');
          },
        } as never),
        Layer.of(Live, {
          status: 'open',
          hold: () => ({ unsubscribe: () => undefined }),
          subscribeStatus: (listener: (status: string) => void) => {
            listener('open');
            return () => undefined;
          },
          call: async () => {
            throw new Error('the socket lane is not part of this case');
          },
        } as never),
        Layer.of(Door, {} as never),
        Layer.of(ProjectDoor, { lens: () => ({ project: '1' }) } as never),
        Layer.of(TerminalOutput, new TerminalOutput(pageTime(), pageHidden, scope)),
        Layer.of(TerminalKeymap, new TerminalKeymap(new Host('tab', 'linux'))),
      ),
      { ladder: [ProjectRung], effectRoot: (build) => $effect.root(build) },
    );
    void graph.open(app);
    const rung = graph.openRung(app, ProjectRung, { projectId: 1 });
    void rung.ready;
    panes = new TerminalViews(rung.scope, { zoom: () => undefined, resetZoom: () => undefined } as never, () => undefined);
  });
  return {
    panes,
    stop: async () => {
      stop();
      await app.close();
      await scope.close();
    },
  };
}

test('leases share a pane, protect it from eviction, then trim released panes oldest first and forget their seat', async () => {
  const held = stand();
  try {
    const leases = Array.from({ length: HELD }, (_, index) => held.panes.lease(`view-${index}`, birth(`x-${index}`)));
    const again = held.panes.lease('view-0', birth('x-0'));
    expect(again.pane).toBe(leases[0]?.pane);
    expect(again.pane.address).toEqual({ execution: 'x-0', incarnation: 0 });
    expect(held.panes.pane('view-never')).toBeNull();

    leases[1]?.release();
    leases[0]?.release();
    const next = held.panes.lease('view-next', birth('x-next'));
    expect(held.panes.pane('view-1')).toBeNull();
    expect(held.panes.pane('view-0')).toBe(again.pane);

    again.release();
    held.panes.holding('view-0')?.release();
    const more = held.panes.lease('view-more', birth('x-more'));
    expect(held.panes.pane('view-0')).toBeNull();
    const overflow = held.panes.lease('view-overflow', birth('x-overflow'));
    for (const lease of [...leases.slice(2), next, more, overflow]) {
      expect(held.panes.pane(lease.pane.id)).toBe(lease.pane);
      lease.release();
    }
    await Promise.resolve();
    expect(held.panes.pane('view-2')).toBeNull();
    expect(held.panes.pane('view-overflow')).toBe(overflow.pane);

    held.panes.forget('view-overflow');
    expect(held.panes.pane('view-overflow')).toBeNull();
    expect(held.panes.lease('view-overflow', birth('x-overflow')).pane).not.toBe(overflow.pane);
  } finally {
    await held.stop();
  }
});

async function until(reached: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (reached()) return;
    await new Promise((done) => setTimeout(done, 0));
  }
  throw new Error(`never reached: ${what}`);
}

type Act = { readonly cause: string; readonly act: { readonly _tag: string } };

function catalog() {
  return {
    entries: SETTING_KEYS.filter((key) => key.section === 'terminal').map((key) => ({
      id: key.id,
      section: key.section,
      title: key.title,
      description: key.description,
      scopes: key.scopes,
      merge: key.merge,
      value: key.fallback,
      from: 'default',
      fallback: key.fallback,
      layers: {},
    })),
    sections: [],
    rejections: [],
  };
}

async function keyboard() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly changed: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
      observe(target: Element): void {
        queueMicrotask(() => this.changed([{ target, isIntersecting: true }]));
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  const clipboard = { readText: () => Promise.resolve('typed'), writeText: () => Promise.resolve() };
  vi.stubGlobal(
    'navigator',
    new Proxy(navigator, {
      get: (held, key) => (key === 'clipboard' ? clipboard : Reflect.get(held, key, held)),
    }),
  );
  const acts: Act[] = [];
  const body = 'hello from the cli';
  const repo = {
    record: { key: () => ({ refresh: async () => undefined }) },
    bytes: {
      key: () => ({
        refresh: async () => ({
          range: {
            next: ByteOffset.make(String(body.length)),
            durableThrough: ByteOffset.make(String(body.length)),
            retainedFrom: ByteOffset.make('0'),
            gap: false,
            cursor: { offset: ByteOffset.make('0') },
          },
          bytes: btoa(body),
        }),
      }),
    },
    input: { run: async (act: Act) => (acts.push(act), undefined) },
    laneOpen: { run: async () => ({ binding: 'lane-1' }) },
    laneClose: { run: async () => ({ closed: true }) },
    stop: { run: async () => undefined },
  };
  const scope = Scope.make('thread-panes-keyboard');
  const app = Scope.make('thread-panes-keyboard-app');
  let panes!: TerminalViews;
  let pane!: TerminalPane;
  const stop = $effect.root(() => {
    const appearance = new TerminalAppearance(
      {
        catalog: { key: () => ({ data: catalog(), refresh: () => Promise.resolve(catalog()) }) },
        write: { data: undefined },
      } as never,
      { contextProject: { id: 1 } } as never,
      { mode: 'dark' } as never,
    );
    const graph = new Graph(
      Layer.mergeAll(
        Layer.of(ExecutionsRepo, repo as never),
        Layer.of(
          TerminalRenderPolicy,
          new TerminalRenderPolicy(
            new Host('tab', 'linux'),
            () => ({ webgl2: false, renderer: null, vendor: null, displayServer: null }),
            { requestFrame: () => 0, cancelFrame: () => undefined, delay: () => 0, now: () => 0 },
            () => 'off',
          ),
        ),
        Layer.of(TerminalAppearance, appearance),
        Layer.of(TerminalHolders, new TerminalHolders(() => [], ThreadNames.make())),
        Layer.of(Notices, { error: () => undefined, refusal: () => undefined } as never),
        Layer.of(Host, new Host('tab', 'linux')),
        Layer.of(FileOpener, { open: () => Promise.resolve(), stage: () => () => undefined, stand: () => () => undefined } as never),
        Layer.of(PathRoads, { road: () => async () => null } as never),
        Layer.of(Opening, {
          open: () => {
            throw new Error('links are not part of this case');
          },
        } as never),
        Layer.of(Live, {
          status: 'open',
          hold: () => ({ unsubscribe: () => undefined }),
          subscribeStatus: (listener: (status: string) => void) => {
            listener('open');
            return () => undefined;
          },
          call: async (work: (client: unknown) => unknown) =>
            work({
              'terminal.screen.point': () => ({ _tag: 'ScreenUnavailable', reason: 'transport', detail: 'this case opens on the record' }),
            }),
        } as never),
        Layer.of(Door, {} as never),
        Layer.of(ProjectDoor, { lens: () => ({ project: '1' }) } as never),
        Layer.of(TerminalOutput, new TerminalOutput(pageTime(), pageHidden, scope)),
        Layer.of(TerminalKeymap, new TerminalKeymap(new Host('tab', 'linux'))),
      ),
      { ladder: [ProjectRung], effectRoot: (build) => $effect.root(build) },
    );
    void graph.open(app);
    const rung = graph.openRung(app, ProjectRung, { projectId: 1 });
    void rung.ready;
    panes = new TerminalViews(rung.scope, appearance, () => undefined);
    pane = panes.lease('thread-a', birth('a-1')).pane;
  });
  await tick();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const mounted = mount(TerminalPaneHost, { target: host, props: { pane, isMac: false } });
  await until(() => pane.paintedAt !== null, 'the replayed record to paint');
  return {
    pane,
    acts,
    stop: async () => {
      await unmount(mounted);
      stop();
      await app.close();
      await scope.close();
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

test('the first painted frame takes the keyboard for paste and search', async () => {
  const live = await keyboard();
  try {
    const element = live.pane.chrome().querySelector('textarea');
    expect(element).not.toBeNull();
    expect(live.pane.chrome().contains(document.activeElement)).toBe(true);

    element?.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', keyCode: 86, ctrlKey: true, bubbles: true, cancelable: true }));
    await until(() => live.acts.some((act) => act.cause === 'paste'), 'the paste act');
    expect(live.acts.some((act) => act.cause === 'paste' && act.act._tag === 'Write')).toBe(true);

    element?.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', keyCode: 70, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(live.pane.searching).toBe(true);
  } finally {
    await live.stop();
  }
});
