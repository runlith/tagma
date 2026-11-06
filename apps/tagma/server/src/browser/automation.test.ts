import { expect } from 'bun:test';
import * as BunPath from '@effect/platform-bun/BunPath';
import { connect } from '@runlith/cdp/session';
import { it } from '@runlith/effect-test';
import * as Memory from '@runlith/testbed/memory';
import { Deferred, Effect, Exit, Fiber, PubSub, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { forProject } from '../invocation/testing/call.js';
import type { Refused } from '../platform/contract/service/body.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { DeclaredAnswer } from '../platform/contract/wire/operation.js';
import type { CurrentProject } from '../projects/contract/service/caller.js';
import { Automation } from './contract/service/automation.js';
import type { Host, Moved } from './contract/service/hosts.js';
import { Pages } from './contract/service/pages.js';
import { Screencast } from './contract/service/screencast.js';
import { browserChannels } from './feeds.js';
import { BrowserPlace } from './contract/service/place.js';
import { Profiles } from './contract/service/profiles.js';
import { ThreadRuns } from './contract/service/runs.js';
import { PageId, ProfileId } from './contract/wire/ids.js';
import type { Live, Page } from './contract/wire/page.js';
import type { Frame, ScreencastEvent } from './contract/wire/screencast.js';
import type { PAGE_OPERATIONS } from './contract/wire/pageOperations.js';
import { conditionsOf, NETWORKS, NO_CONDITIONS } from './contract/wire/emulation.js';
import { type Strain, strainOf } from './contract/wire/host.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { ServedRoots } from './contract/service/sources.js';
import { fixedCheckoutPaths } from '../workspace/testing/doubles.js';
import { makeAutomation } from './engine/automation.js';
import { makeAnalysis } from './engine/analysis.js';
import { makeDrive } from './engine/drive.js';
import { makeScreencast } from './engine/screencast.js';
import { PAGE_PAIRS } from './operations.js';

type Act = typeof PAGE_OPERATIONS.act_on_page;
type Call = Effect.Effect<DeclaredAnswer<Act['answer']>, Refused<Act>, Automation | Pages | CurrentProject>;
type Emulate = typeof PAGE_OPERATIONS.emulate_page;
type EmulateCall = Effect.Effect<DeclaredAnswer<Emulate['answer']>, Refused<Emulate>, Automation | Pages | CurrentProject>;
type Snapshot = typeof PAGE_OPERATIONS.snapshot_page;
type SnapshotCall = Effect.Effect<DeclaredAnswer<Snapshot['answer']>, Refused<Snapshot>, Automation | Pages | CurrentProject>;
type Evaluate = typeof PAGE_OPERATIONS.evaluate_in_page;
type EvaluateCall = Effect.Effect<DeclaredAnswer<Evaluate['answer']>, Refused<Evaluate>, Automation | Pages | CurrentProject>;
type Capture = typeof PAGE_OPERATIONS.capture_page;
type CaptureCall = Effect.Effect<DeclaredAnswer<Capture['answer']>, Refused<Capture>, Automation | Pages | CurrentProject>;
const unused = () => Effect.die('this scenario does not use this port');
const PAGE = PageId.make('01a184cf-76ca-7d83-87c6-2f78805e2612');
const CHROMIUM_FRAMES_IN_FLIGHT = 2;
const caller: Caller = {
  actor: { kind: 'thread', threadId: 'agent', projectId: 1, principalId: 'agent', session: { harness: 'tagma', key: 'agent' } },
  files: null,
};

const engine = Effect.fnUntraced(function* (
  mode:
    | 'dialog'
    | 'detach'
    | 'conditions'
    | 'replacement'
    | 'late-adoption'
    | 'pick-detach'
    | 'heap'
    | 'viewport'
    | 'viewport-quantized'
    | 'screencast'
    | 'silent-frame',
) {
  const incoming = yield* Queue.unbounded<string>();
  const frameTrees = yield* Queue.unbounded<string>();
  const answeredTrees = yield* Queue.unbounded<string>();
  const started = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const adopting = yield* Deferred.make<void>();
  const adopted = yield* Deferred.make<void>();
  let latency = 0;
  let clicks = 0;
  let native = { width: 1280, height: 800 };
  let viewport = native;
  let overridden = false;
  const sizing = mode === 'viewport' || mode === 'viewport-quantized';
  let holdViewport = false;
  let viewportRead: { readonly id: number; readonly sessionId: string | undefined } | null = null;
  const resizing = yield* Deferred.make<void>();
  const changingViewport = yield* Deferred.make<void>();
  const screencasting = yield* Deferred.make<void>();
  const silent = yield* Deferred.make<void>();
  let castSession = 0;
  let framesInFlight = 0;
  let pictures = 0;
  let pointerX = 0;
  const inspecting = new Set<string>();
  const rates = new Map<string, number>();
  const strains = new Set<Strain>();
  const connection = yield* connect({
    incoming: Stream.fromQueue(incoming),
    send: Effect.fnUntraced(function* (text) {
      const command = JSON.parse(text) as {
        readonly id: number;
        readonly method: string;
        readonly sessionId?: string;
        readonly params?: {
          readonly type?: string;
          readonly key?: string;
          readonly mode?: string;
          readonly rate?: number;
          readonly sessionId?: number;
          readonly x?: number;
          readonly width?: number;
          readonly height?: number;
          readonly expression?: string;
          readonly matchedNetworkConditions?: readonly { readonly latency: number }[];
        };
      };
      if (command.method === 'Page.startScreencast') {
        castSession += 1;
        framesInFlight = 0;
        yield* Deferred.succeed(screencasting, undefined);
      }
      if (command.method === 'Page.screencastFrameAck' && command.params?.sessionId === castSession) framesInFlight -= 1;
      if (command.method === 'Input.dispatchMouseEvent') pointerX = command.params?.x ?? 0;
      if (
        mode === 'silent-frame' &&
        command.method === 'Accessibility.getRootAXNode' &&
        command.sessionId === 'child' &&
        !Deferred.isDoneUnsafe(silent)
      ) {
        yield* Deferred.succeed(silent, undefined);
        return;
      }
      if (command.method === 'Input.dispatchKeyEvent' && command.params?.type === 'keyDown') {
        if (mode === 'dialog' && command.params.key === 'a') {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        }
        if (mode === 'detach' && command.params.key === 'b') {
          yield* Queue.offer(incoming, JSON.stringify({ method: 'Target.detachedFromTarget', params: { sessionId: 'engine' } }));
          return;
        }
      }
      if (mode === 'pick-detach' && command.method === 'Overlay.setInspectMode') {
        if (command.params?.mode === 'none' && command.sessionId === 'child-old') {
          yield* Queue.offer(
            incoming,
            JSON.stringify({ method: 'Target.detachedFromTarget', params: { sessionId: 'child-old' }, sessionId: 'engine' }),
          );
          return;
        }
        if (command.params?.mode === 'searchForNode') inspecting.add(command.sessionId ?? 'engine');
        else inspecting.delete(command.sessionId ?? 'engine');
      }
      if (
        mode === 'pick-detach' &&
        command.method === 'Input.dispatchMouseEvent' &&
        command.params?.type === 'mouseReleased' &&
        !inspecting.has('child-new')
      )
        clicks += 1;
      if (command.method === 'Emulation.setCPUThrottlingRate') rates.set(command.sessionId ?? '', command.params?.rate ?? 1);
      if (mode === 'conditions' && command.sessionId === 'child') {
        if (command.method === 'Emulation.setCPUThrottlingRate' && !Deferred.isDoneUnsafe(adopting)) {
          yield* Deferred.succeed(adopting, undefined);
          yield* Deferred.await(release);
        }
        if (command.method === 'Network.emulateNetworkConditionsByRule')
          latency = command.params?.matchedNetworkConditions?.[0]?.latency ?? 0;
        if (command.method === 'Page.getFrameTree') yield* Deferred.succeed(adopted, undefined);
      }
      if (command.method === 'Page.getFrameTree' && command.sessionId?.startsWith('child')) {
        yield* Queue.offer(frameTrees, command.sessionId);
        if (mode === 'late-adoption' && command.sessionId === 'child-old') yield* Deferred.await(release);
      }
      if (sizing) {
        const before = viewport;
        if (command.method === 'Emulation.setDeviceMetricsOverride') {
          overridden = true;
          viewport = { width: command.params?.width ?? 0, height: command.params?.height ?? 0 };
          yield* Deferred.succeed(changingViewport, undefined);
        } else if (command.method === 'Emulation.clearDeviceMetricsOverride') {
          overridden = false;
          viewport = native;
        }
        if (before.width !== viewport.width || before.height !== viewport.height)
          yield* Queue.offer(incoming, JSON.stringify({ method: 'Page.frameResized', params: {}, sessionId: 'engine' }));
        if (command.method === 'Runtime.evaluate' && command.params?.expression?.includes('visualViewport')) {
          if (holdViewport) {
            holdViewport = false;
            viewportRead = { id: command.id, sessionId: command.sessionId };
            yield* Deferred.succeed(resizing, undefined);
            return;
          }
          if (Deferred.isDoneUnsafe(resizing)) yield* Deferred.succeed(changingViewport, undefined);
        }
      }
      const layoutViewport = { pageX: 0, pageY: 0, clientWidth: viewport.width, clientHeight: viewport.height };
      const visualViewport = { ...layoutViewport, offsetX: 0, offsetY: 0, scale: 1, zoom: 1 };
      const contentSize = { x: 0, y: 0, ...viewport };
      const result =
        command.method === 'Page.getLayoutMetrics'
          ? {
              layoutViewport,
              visualViewport,
              contentSize,
              cssLayoutViewport: layoutViewport,
              cssVisualViewport: visualViewport,
              cssContentSize: contentSize,
            }
          : command.method === 'Accessibility.getRootAXNode'
            ? { node: { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['button'] } }
            : command.method === 'Accessibility.getChildAXNodes'
              ? { nodes: [{ nodeId: 'button', role: { value: 'button' }, name: { value: command.sessionId }, backendDOMNodeId: 2 }] }
              : command.method === 'Runtime.evaluate'
                ? {
                    result: sizing
                      ? {
                          type: 'object',
                          value:
                            command.params?.expression === '[innerWidth, innerHeight]'
                              ? [viewport.width, viewport.height]
                              : mode === 'viewport-quantized'
                                ? { width: viewport.width - 1, height: viewport.height }
                                : viewport,
                        }
                      : mode === 'pick-detach'
                        ? { type: 'number', value: clicks }
                        : { type: 'object', subtype: 'null', value: null },
                  }
                : command.method === 'Page.createIsolatedWorld'
                  ? { executionContextId: 1 }
                  : command.method === 'Page.getFrameTree'
                    ? {
                        frameTree: {
                          frame: command.sessionId?.startsWith('child')
                            ? {
                                id: 'child-frame',
                                parentId: 'frame',
                                loaderId: `${command.sessionId}-document`,
                                url: 'https://frame.example/',
                              }
                            : { id: 'frame', loaderId: 'document', url: 'https://example.test/' },
                        },
                      }
                    : {};
      yield* Queue.offer(incoming, JSON.stringify({ id: command.id, result }));
      if (command.method === 'Page.getFrameTree' && command.sessionId?.startsWith('child'))
        yield* Queue.offer(answeredTrees, command.sessionId);
    }),
  });
  const session = yield* connection.attach('engine');
  const moves = yield* PubSub.unbounded<Moved>();
  let live: Live = {
    loading: false,
    back: false,
    forward: false,
    crashed: false,
    responsive: true,
    dialog: null,
    driven: null,
    shown: false,
    conditions: NO_CONDITIONS,
    trace: null,
    recording: null,
  };
  const record: Page = {
    id: PAGE,
    projectId: 1,
    profile: ProfileId.make('test'),
    url: 'https://example.test/',
    title: 'Form',
    favicon: null,
    openedBy: 'agent',
    opener: null,
    state: 'live',
    host: 'test',
    live,
    downloads: 0,
    activeAt: '2026-10-01T00:00:00.000Z',
    closedAt: null,
  };
  const host: Host = {
    id: 'test',
    adapter: 'test',
    pid: null,
    native: false,
    capture: null,
    pages: {
      open: unused,
      adopt: unused,
      close: unused,
      live: unused(),
      navigate: unused,
      navigation: () => Effect.succeed({ changes: [], blocked: Effect.never, check: Effect.void }),
      pdf: unused,
      heap: () => (mode === 'heap' ? Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(release)) : unused()),
      strain: (_page, strain) =>
        mode === 'conditions' || mode === 'heap'
          ? Effect.asVoid(
              Effect.acquireRelease(
                Effect.sync(() => {
                  const held = { ...strain };
                  strains.add(held);
                  return held;
                }),
                (held) => Effect.sync(() => strains.delete(held)),
              ),
            )
          : unused(),
      geolocation: unused,
      answer: unused,
      events: unused(),
      paint: () => (mode === 'pick-detach' || mode === 'screencast' ? Effect.void : unused()),
      session: () => Effect.succeed(session),
    },
    profiles: { prepare: unused, session: unused, remove: unused },
  };
  const pages = Pages.of({
    open: unused,
    close: unused,
    list: unused,
    changes: unused,
    downloads: unused,
    closeProfile: unused,
    commit: unused,
    resolve: () => Effect.sync(() => ({ ...record, live })),
    hold: () => Effect.succeed(host),
    navigation: () => Effect.succeed({ changes: [], blocked: Effect.never, check: Effect.void }),
    live: () => live,
    operate: unused,
    operated: () => undefined,
    mark: Effect.fnUntraced(function* (_page, change) {
      live = { ...live, ...change };
      yield* PubSub.publish(moves, { live, signal: 'changed' } satisfies Moved);
    }),
    hungFrame: () => undefined,
    inProfile: () => [],
    glance: (_page, navigated) => ({
      id: PAGE,
      url: record.url,
      title: record.title,
      loading: live.loading,
      dialog: live.dialog,
      navigated,
      conditions: conditionsOf(live.conditions),
    }),
    moves: () => Effect.map(PubSub.subscribe(moves), Stream.fromSubscription),
    profileOf: () => record.profile,
    urlOf: () => record.url,
  });
  const profiles = Profiles.of({
    list: unused(),
    record: () =>
      Effect.succeed({
        id: record.profile,
        name: 'Test',
        adapter: 'test',
        document: {},
        console: 'never' as const,
        input: 'fast' as const,
        removal: null,
        createdAt: new Date(0),
      }),
    chosen: unused,
    create: unused,
    update: unused,
    remove: unused,
    clear: unused,
    connected: unused(),
    exclusive: unused,
    changes: Effect.succeed(Stream.empty),
  });
  const drive = yield* makeDrive({
    pages,
    profiles,
    runs: ThreadRuns.of({ running: () => Effect.succeed(true), ending: () => Effect.succeed(Effect.never) }),
  });
  const analysis = yield* makeAnalysis();
  const automation = yield* makeAutomation({
    drive,
    analysis:
      mode === 'heap'
        ? {
            ...analysis,
            heap: () => Effect.succeed({ sizeBytes: 0, objectCount: 0, detachedNodes: 0, classCount: 0, classes: [], growth: [] }),
          }
        : analysis,
  }).pipe(
    Effect.provideService(Pages, pages),
    Effect.provideService(Profiles, profiles),
    Effect.provideService(ThreadRuns, ThreadRuns.of({ running: () => Effect.succeed(true), ending: () => Effect.succeed(Effect.never) })),
    Effect.provideService(BrowserPlace, { root: '/browser' }),
    Effect.provideService(CheckoutPaths, yield* fixedCheckoutPaths(1, [])),
    Effect.provideService(ServedRoots, { root: unused }),
    Effect.provide(BunPath.layer),
    Effect.provide(Memory.layer),
  );
  const { screencast } = yield* makeScreencast({ pages, drive }).pipe(
    Effect.provideService(BrowserPlace, { root: '/browser' }),
    Effect.provide(BunPath.layer),
    Effect.provide(Memory.layer),
  );
  const act = (steps: Act['input']['Type']['steps']) =>
    (PAGE_PAIRS.act_on_page.body.execute({ page: PAGE, steps }, undefined, caller) as Call).pipe(
      forProject(Effect.succeed({ project: { id: 1, name: 'browser' } })),
      Effect.provideService(Pages, pages),
      Effect.provideService(Automation, automation),
    );
  const emulate = (change: Emulate['input']['Type']) =>
    (PAGE_PAIRS.emulate_page.body.execute({ ...change, page: PAGE }, undefined, caller) as EmulateCall).pipe(
      forProject(Effect.succeed({ project: { id: 1, name: 'browser' } })),
      Effect.provideService(Pages, pages),
      Effect.provideService(Automation, automation),
    );
  const join = (child: string) =>
    Queue.offer(
      incoming,
      JSON.stringify({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: child,
          targetInfo: { targetId: 'child-frame', type: 'iframe', url: 'https://frame.example/' },
          waitingForDebugger: false,
        },
        sessionId: 'engine',
      }),
    );
  const channels = browserChannels(
    pages,
    Automation.of({
      ...automation,
      pick: (...args) => automation.pick(...args).pipe(Effect.tap(() => Deferred.succeed(started, undefined))),
    }),
    Screencast.of({ watch: () => Stream.die('this scenario does not watch a screencast'), input: unused, choose: unused }),
  );
  return {
    act,
    screencast,
    screencasting: Deferred.await(screencasting),
    silent: Deferred.await(silent),
    pointerX: () => pointerX,
    capture: (picture: string) =>
      Effect.suspend(() => {
        if (framesInFlight > CHROMIUM_FRAMES_IN_FLIGHT) return Effect.succeed(undefined);
        framesInFlight += 1;
        const width = 100 + (pictures += 1);
        return Effect.as(
          Queue.offer(
            incoming,
            JSON.stringify({
              method: 'Page.screencastFrame',
              params: { data: picture, metadata: { deviceWidth: width, deviceHeight: 300, timestamp: 0 }, sessionId: castSession },
              sessionId: 'engine',
            }),
          ),
          width,
        );
      }),
    pick: channels['browser.pick']({ projectId: 1, page: PAGE }),
    evaluate: (expression = 'globalThis.clicks') =>
      (PAGE_PAIRS.evaluate_in_page.body.execute({ page: PAGE, expression }, undefined, caller) as EvaluateCall).pipe(
        forProject(Effect.succeed({ project: { id: 1, name: 'browser' } })),
        Effect.provideService(Pages, pages),
        Effect.provideService(Automation, automation),
      ),
    heap: () =>
      (PAGE_PAIRS.capture_page.body.execute({ page: PAGE, what: 'heap' }, undefined, caller) as CaptureCall).pipe(
        forProject(Effect.succeed({ project: { id: 1, name: 'browser' } })),
        Effect.provideService(Pages, pages),
        Effect.provideService(Automation, automation),
      ),
    snapshot: () =>
      (PAGE_PAIRS.snapshot_page.body.execute({ page: PAGE }, undefined, caller) as SnapshotCall).pipe(
        forProject(Effect.succeed({ project: { id: 1, name: 'browser' } })),
        Effect.provideService(Pages, pages),
        Effect.provideService(Automation, automation),
      ),
    frame: (child: string) => Effect.andThen(join(child), Queue.take(frameTrees)),
    answeredTree: Queue.take(answeredTrees),
    barrier: Effect.gen(function* () {
      const changes = yield* pages.moves(PAGE);
      yield* Queue.offer(
        incoming,
        JSON.stringify({
          method: 'Page.javascriptDialogOpening',
          params: { type: 'alert', message: 'barrier', url: 'https://example.test/' },
          sessionId: 'engine',
        }),
      );
      yield* Stream.runHead(Stream.filter(changes, (change) => change.live.dialog?.message === 'barrier'));
      yield* pages.mark(PAGE, { dialog: null });
    }),
    retire: Effect.fnUntraced(function* (child: string) {
      const changes = yield* pages.moves(PAGE);
      yield* Queue.offer(
        incoming,
        JSON.stringify({ method: 'Target.detachedFromTarget', params: { sessionId: child }, sessionId: 'engine' }),
      );
      yield* Queue.offer(
        incoming,
        JSON.stringify({
          method: 'Page.javascriptDialogOpening',
          params: { type: 'alert', message: 'retired', url: 'https://example.test/' },
          sessionId: 'engine',
        }),
      );
      yield* Stream.runHead(Stream.filter(changes, (change) => change.live.dialog?.message === 'retired'));
      yield* pages.mark(PAGE, { dialog: null });
    }),
    started,
    pages,
    emulate,
    adopting,
    adopted,
    latency: () => latency,
    rate: (session = 'engine') => rates.get(session) ?? 1,
    strain: () => strainOf(strains),
    release: Effect.gen(function* () {
      yield* Deferred.succeed(release, undefined);
      if (viewportRead !== null) {
        const reply = viewportRead;
        viewportRead = null;
        yield* Queue.offer(incoming, JSON.stringify({ ...reply, result: { result: { type: 'object', value: native } } }));
      }
    }),
    resize: Effect.gen(function* () {
      native = { width: 900, height: 700 };
      viewport = native;
      holdViewport = true;
      yield* Queue.offer(incoming, JSON.stringify({ method: 'Page.frameResized', params: {}, sessionId: 'engine' }));
      yield* Deferred.await(resizing);
    }),
    resizeNative: Effect.gen(function* () {
      native = { width: 900, height: 700 };
      if (!overridden) {
        viewport = native;
        yield* Queue.offer(incoming, JSON.stringify({ method: 'Page.frameResized', params: {}, sessionId: 'engine' }));
      }
    }),
    changingViewport: Deferred.await(changingViewport),
    join: join('child'),
  };
});

it.effect('a viewer that took no frame while Chromium ran out of frame credit still receives the last picture', () =>
  Effect.gen(function* () {
    const browser = yield* engine('screencast');
    const pull = yield* Stream.toPull(browser.screencast.watch(PAGE, { width: 400, height: 300, scale: 1 }));
    const held: ScreencastEvent[] = [];
    const next = Effect.suspend(() => {
      const first = held.shift();
      return first !== undefined
        ? Effect.succeed(first)
        : Effect.map(pull, (chunk) => {
            held.push(...chunk.slice(1));
            return chunk[0];
          });
    });
    const frame: Effect.Effect<Frame, unknown> = Effect.flatMap(next, (event) => (event.type === 'frame' ? Effect.succeed(event) : frame));
    const named = yield* next;
    if (named.type !== 'viewer') return yield* Effect.die('the stream did not name its viewer first');
    yield* browser.screencasting;
    let turn = 0;
    const captured = Effect.fnUntraced(function* (picture: string) {
      const width = yield* browser.capture(picture);
      if (width === undefined) return;
      while (browser.pointerX() !== width) {
        yield* browser.screencast.input(PAGE, named.viewer, turn++, [
          { kind: 'mouse', type: 'move', x: 1, y: 0, button: 'none', clicks: 0, modifiers: 0 },
        ]);
        yield* Effect.yieldNow;
      }
    });
    yield* captured('first');
    expect((yield* frame).data).toBe('first');
    for (const picture of ['one', 'two', 'three', 'last']) yield* captured(picture);
    expect((yield* frame).data).toBe('last');
  }),
);

it.effect('a native resize before a device override becomes the restored viewport', () =>
  Effect.gen(function* () {
    const browser = yield* engine('viewport');
    yield* browser.emulate({ conditions: false });
    yield* browser.resize;
    const changing = yield* Effect.forkChild(browser.emulate({ device: 'iphone-15' }), { startImmediately: true });
    yield* browser.changingViewport;
    yield* browser.release;
    yield* Fiber.join(changing);
    yield* browser.emulate({ clear: true });
    expect(yield* browser.evaluate('[innerWidth, innerHeight]')).toMatchObject({ status: 'evaluated', value: '[900,700]' });
  }),
);

it.effect('clearing a device accepts a native resize hidden by the override', () =>
  Effect.gen(function* () {
    const browser = yield* engine('viewport');
    yield* browser.emulate({ device: 'iphone-15' });
    yield* browser.resizeNative;
    expect(yield* browser.evaluate('[innerWidth, innerHeight]')).toMatchObject({ status: 'evaluated', value: '[393,852]' });
    yield* browser.emulate({ clear: true });
    expect(yield* browser.evaluate('[innerWidth, innerHeight]')).toMatchObject({ status: 'evaluated', value: '[900,700]' });
  }),
);

it.effect('a post-write resize settles an override with non-exact normalized dimensions', () =>
  Effect.gen(function* () {
    const browser = yield* engine('viewport-quantized');
    yield* browser.emulate({ viewport: { width: 900, height: 700, scale: 1 } });
    expect(yield* browser.evaluate('[innerWidth, innerHeight]')).toMatchObject({ status: 'evaluated', value: '[900,700]' });
  }),
);

it.effect('CPU emulation sends the renderer rate and scopes the matching strain until it is cleared', () =>
  Effect.gen(function* () {
    const browser = yield* engine('conditions');
    yield* browser.emulate({ cpu: 6 });
    expect(browser.rate()).toBe(6);
    expect(browser.strain()).toEqual({ factor: 6, paused: false });
    yield* browser.emulate({ conditions: false });
    expect(browser.rate()).toBe(1);
    expect(browser.strain()).toEqual({ factor: 1, paused: false });
  }),
);

it.effect('canceling a heap capture waits for its admitted renderer producer to settle', () =>
  Effect.gen(function* () {
    const browser = yield* engine('heap');
    const capturing = yield* Effect.forkChild(browser.heap());
    yield* Deferred.await(browser.started);
    const ended = yield* Deferred.make<void>();
    const interrupted = yield* Effect.forkChild(Effect.andThen(Fiber.interrupt(capturing), Deferred.succeed(ended, undefined)));
    yield* TestClock.adjust('6 seconds');
    expect(Deferred.isDoneUnsafe(ended)).toBe(false);
    expect(browser.strain()).toEqual({ factor: 1, paused: true });
    yield* browser.release;
    yield* Fiber.join(interrupted);
    expect(Deferred.isDoneUnsafe(ended)).toBe(true);
    expect(browser.strain()).toEqual({ factor: 1, paused: false });
    expect(browser.pages.live(PAGE)?.responsive).toBe(true);
  }),
);

it.effect('ending a pick releases surviving frames when another frame detaches during cleanup', () =>
  Effect.gen(function* () {
    const browser = yield* engine('pick-detach');
    yield* browser.snapshot();
    yield* browser.frame('child-old');
    yield* browser.frame('child-new');
    const picking = yield* Effect.forkChild(Stream.runDrain(browser.pick));
    yield* Deferred.await(browser.started);
    yield* Fiber.interrupt(picking);
    yield* browser.act([{ action: 'click', x: 200, y: 100 }]);
    expect(yield* browser.evaluate()).toMatchObject({ value: '1' });
  }),
);

it.effect('canceling a snapshot pending on a silent frame session releases the page queue to the next snapshot', () =>
  Effect.gen(function* () {
    const browser = yield* engine('silent-frame');
    yield* browser.snapshot();
    yield* browser.frame('child');
    const reading = yield* Effect.forkChild(browser.snapshot(), { startImmediately: true });
    yield* browser.silent;
    yield* Fiber.interrupt(reading);
    expect(Exit.hasInterrupts(yield* Fiber.await(reading))).toBe(true);
    expect((yield* browser.snapshot()).text).toContain('button "child"');
  }),
);

it.effect('a late outgoing frame tree cannot overwrite its ready replacement', () =>
  Effect.gen(function* () {
    const browser = yield* engine('late-adoption');
    yield* browser.snapshot();
    yield* browser.frame('child-old');
    yield* browser.frame('child-new');
    yield* browser.answeredTree;
    const before = (yield* browser.snapshot()).text.split('\n').find((line) => line.includes('button "child-new"'));
    expect(before).toMatch(/\[ref=e\d+\]/);
    yield* browser.release;
    yield* browser.answeredTree;
    yield* browser.barrier;
    expect((yield* browser.snapshot()).text).toContain(before!);
    yield* browser.retire('child-old');
    expect((yield* browser.snapshot()).text).toContain(before!);
  }),
);

it.effect('retiring an old frame session leaves its replacement readable', () =>
  Effect.gen(function* () {
    const browser = yield* engine('replacement');
    yield* browser.snapshot();
    yield* browser.frame('child-old');
    expect((yield* browser.snapshot()).text).toContain('button "child-old"');
    yield* browser.frame('child-new');
    expect((yield* browser.snapshot()).text).toContain('button "child-new"');
    yield* browser.retire('child-old');
    expect((yield* browser.snapshot()).text).toContain('button "child-new"');
  }),
);

it.effect('a late frame keeps the newest network conditions when its initial CPU command overlaps an update', () =>
  Effect.gen(function* () {
    const browser = yield* engine('conditions');
    yield* browser.emulate({ cpu: 6, network: 'slow-3g' });
    yield* browser.join;
    yield* Deferred.await(browser.adopting);
    const changing = yield* Effect.forkChild(browser.emulate({ network: 'fast-4g' }), { startImmediately: true });
    yield* TestClock.adjust(0);
    yield* browser.release;
    const changed = yield* Fiber.join(changing);
    yield* Deferred.await(browser.adopted);
    expect(changed.emulation.network).toBe('fast-4g');
    expect(browser.latency()).toBe(NETWORKS['fast-4g'].latency);
    expect(browser.rate('child')).toBe(6);
  }),
);

it.effect('a queued sequence refuses a dialog opened while the preceding call owns the page', () =>
  Effect.gen(function* () {
    const browser = yield* engine('dialog');
    const first = yield* Effect.forkChild(browser.act([{ action: 'press', key: 'a' }]));
    yield* Deferred.await(browser.started);
    const queued = yield* Effect.forkChild(browser.act([{ action: 'press', key: 'b' }]));
    yield* Effect.yieldNow;
    yield* browser.pages.mark(PAGE, { dialog: { kind: 'confirm', message: 'Proceed?', prompt: null, url: 'https://example.test/' } });
    expect(yield* Fiber.join(first)).toMatchObject({ completed: 0, stopped: 1 });
    const refused = yield* Effect.flip(Fiber.join(queued));
    if (!(refused instanceof GateRefusal)) return yield* Effect.die(refused);
    expect(refused.code).toBe('dialog-open');
  }),
);

it.effect('a live session detached with a pending action refuses an unknown outcome without replaying the sequence', () =>
  Effect.gen(function* () {
    const browser = yield* engine('detach');
    const refused = yield* Effect.flip(
      browser.act([
        { action: 'press', key: 'a' },
        { action: 'press', key: 'b' },
        { action: 'press', key: 'c' },
      ]),
    );
    if (!(refused instanceof GateRefusal)) return yield* Effect.die(refused);
    expect(refused.code).toBe('outcome-unknown');
    expect(refused.reason).toContain('step 2 stopped after 1 completed');
    expect(browser.pages.live(PAGE)?.responsive).toBe(true);
  }),
);
