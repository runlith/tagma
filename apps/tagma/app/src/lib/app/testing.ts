import type { Component } from 'svelte';
import { mount, unmount } from 'svelte';
import { Failure } from '@runlith/layer/Failure';
import { Host } from '@runlith/layer/Host';
import type { KeyClass } from '@runlith/layer/key';
import { Layer, type LayerLike } from '@runlith/layer/Layer';
import type { MountedApp } from '@runlith/layer/App';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { Router } from '@runlith/layer/Router';
import { makePlatform, makeRouter, makeStorage } from '@runlith/layer/testing';
import { stubAll, stubFamily, stubMutation, stubSingle } from '@runlith/query/testing';
import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import { Dialogs } from '@runlith/primitives/DialogRegistry.svelte';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ThreadRung, type ThreadAim } from '$lib/features/workspace/ThreadRung.js';
import { ThreadOnScreen, type ScreenThreads } from '$lib/features/threads/OnScreen.svelte.js';
import { CheckoutScreen } from '$lib/features/checkout/CheckoutScreen.js';
import { ShellOps, type ShellPort } from '$lib/features/workspace/ShellOps.js';
import { Topics } from '$lib/shared/threads/Topics.svelte.js';
import { Overlays } from './overlays.js';
import { Effect } from 'effect';
import type { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { WorktreeWindow } from '$lib/features/worktrees/Window.svelte.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { TEST_ORIGIN } from '$lib/wire/testing.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
import { FileSaver } from '$lib/shared/FileSaver.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import TestHost from './TestHost.svelte';
import { DECLARED_SURFACES } from './declaredSurfaces.js';

export const testAim: GraphAim = { projectId: 1, branch: null };

export const testSurfaces = (): SurfaceRegistry => new SurfaceRegistry(DECLARED_SURFACES);

export const testAddresses = (router: Router = makeRouter()): Addresses => new Addresses(router, testSurfaces());

export const testAddressing = Layer.mergeAll(Layer.provide(SurfaceRegistry, testSurfaces), Addresses);

export type TestApp = {
  readonly app: MountedApp;
  readonly opened: readonly string[];
  draw(view?: Component<never>, props?: Record<string, unknown>): HTMLElement;
  get<Self>(key: KeyClass<string, Self>): Self;
  readonly dialogs: Dialogs;
  readonly storage: PlatformStorage;
  place(aim: GraphAim | undefined): void;
  open(thread: ThreadAim | undefined): void;
  unmount(): Promise<void>;
};

export function mountShell(
  manifest: LayerLike,
  boot: LayerLike = Layer.mergeAll(),
  options: { at?: GraphAim | undefined; thread?: ThreadAim | undefined; storage?: PlatformStorage; router?: Router } = {},
): TestApp {
  const at = 'at' in options ? options.at : testAim;
  const storage = options.storage ?? makeStorage();
  const opened: string[] = [];
  const world = Layer.mergeAll(
    Layer.of(Platform, makePlatform({ local: storage })),
    Layer.of(Router, options.router ?? makeRouter()),
    Host.tab(),
    ServerOrigin.of(TEST_ORIGIN),
    Layer.of(ExternalLinks, { open: (url) => void opened.push(url) }),
    Layer.of(FileSaver, { save: () => undefined }),
    boot as never,
  );
  const graph = mountApp(Layer.mergeAll(manifest as never, Overlays, Topics, testAddressing) as never, world as never, {
    ladder: [ProjectRung, ThreadRung, GraphRung],
    at: { project: at && { projectId: at.projectId }, graph: at, thread: options.thread },
  });
  const drawn: { target: HTMLElement; component: Record<string, unknown> }[] = [];

  return {
    app: graph.app,
    opened,
    get: (key) => graph.get(key),
    get dialogs() {
      return graph.get(Dialogs);
    },
    storage,
    draw(view, props = {}) {
      const target = document.createElement('div');
      document.body.append(target);
      const component = mount(TestHost, { target, props: { app: graph.app, view, props } }) as Record<string, unknown>;
      drawn.push({ target, component });
      return target;
    },
    place: (aim) => {
      graph.place('project', aim && { projectId: aim.projectId });
      graph.place('graph', aim);
    },
    open: (thread) => graph.place('thread', thread),
    unmount: async () => {
      for (const { target, component } of drawn.reverse()) {
        await unmount(component);
        target.remove();
      }
      await graph.unmount();
    },
  };
}

const quietShell: ShellPort = {
  besideOffer: () => 'open',
  openThread: () => Effect.void,
  openProject: () => Effect.void,
  openPane: () => Effect.void,
  revealSurface: () => Effect.void,
};

export const testShellOps = Layer.of(ShellOps, quietShell);

export function screen(host: ThreadSlot | null = null) {
  const shown: ScreenThreads = {
    page: host,
    host,
    shown: host === null ? [] : [host],
    mainFocused: true,
    activation: () => 0,
  };
  return Layer.mergeAll(Layer.of(ThreadOnScreen, shown), Layer.of(CheckoutScreen, shown), testShellOps);
}

export function testTagCatalog(projectId = 1, read: () => Promise<Vocabulary | undefined> = async () => undefined): TagCatalog {
  return new TagCatalog({ of: stubFamily({ loadOrThrow: read }) } as never, projectId, Scope.make(), new Failure(() => undefined));
}

export function testPlaces(): Worktrees {
  const places = {
    aim: { projectId: 1 },
    rows: [],
    grouped: [],
    targets: [],
    bases: [],
    known: false,
    unread: null,
    several: false,
    creations: [],
    moving: [],
    main: null,
    aimed: null,
    byRoot: () => null,
    placeOf: () => null,
    standingOf: () => null,
    creatingOf: () => null,
    holding: () => null,
    folderOf: () => null,
    follow: () => null,
    move: async () => null,
    dismiss: () => undefined,
    placing: (_label: string, work: () => Promise<unknown>) => work(),
    window: () =>
      new WorktreeWindow(
        places as unknown as Worktrees,
        liveFeed().live,
        new Failure((error) => {
          throw error;
        }),
      ),
  };
  return places as unknown as Worktrees;
}

export function threadsRepo(over: Record<string, unknown> = {}): never {
  return {
    roots: stubFamily(),
    archived: stubFamily(),
    see: stubMutation(),
    setArchived: stubMutation(),
    setPinned: stubMutation(),
    setTitle: stubMutation(),
    remove: stubMutation(),
    ...over,
  } as never;
}

export function keyedBy(answer: (key: never) => Promise<unknown>) {
  return {
    name: 'stub',
    key: (key: never) => stubSingle({ refresh: () => answer(key), loadOrThrow: () => answer(key) }),
    all: stubAll,
    reset: () => undefined,
  };
}

export function liveFeed(): {
  frame: ((frame: unknown) => void) | null;
  ended: ((reason: unknown) => void) | null;
  status: ((status: string) => void) | null;
  asked: unknown[];
  routes: Map<string, (frame: unknown) => void>;
  live: never;
} {
  const held: ReturnType<typeof liveFeed> = {
    frame: null,
    ended: null,
    status: null,
    asked: [],
    routes: new Map(),
    live: {
      status: 'open',
      subscribeStatus: (report: (status: string) => void) => {
        held.status = report;
        return () => undefined;
      },
      subscribeFailure: () => () => undefined,
      hold: (open: (client: never) => unknown, frame: (value: unknown) => void, ended?: (reason: unknown) => void) => {
        held.frame = frame;
        held.ended = ended ?? null;
        open(
          new Proxy(
            {},
            {
              get: (_target, name) => (payload: unknown) => {
                held.routes.set(String(name), frame);
                held.asked.push(payload);
              },
            },
          ) as never,
        );
        return { unsubscribe: () => undefined };
      },
    } as never,
  };
  return held;
}
