import { expect } from 'bun:test';
import * as BunPath from '@effect/platform-bun/BunPath';
import { connect } from '@runlith/cdp/session';
import { it } from '@runlith/effect-test';
import * as Memory from '@runlith/testbed/memory';
import { Deferred, Effect, Fiber, PubSub, Queue, Stream } from 'effect';
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
import { BrowserPlace } from './contract/service/place.js';
import { Profiles } from './contract/service/profiles.js';
import { ThreadRuns } from './contract/service/runs.js';
import { PageId, ProfileId } from './contract/wire/ids.js';
import type { Live, Page } from './contract/wire/page.js';
import type { PAGE_OPERATIONS } from './contract/wire/pageOperations.js';
import { conditionsOf, NETWORKS, NO_CONDITIONS } from './contract/wire/emulation.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { ServedRoots } from './contract/service/sources.js';
import { fixedCheckoutPaths } from '../workspace/testing/doubles.js';
import { makeAutomation } from './engine/automation.js';
import { makeDrive } from './engine/drive.js';
import { PAGE_PAIRS } from './operations.js';

type Act = typeof PAGE_OPERATIONS.act_on_page;
type Call = Effect.Effect<DeclaredAnswer<Act['answer']>, Refused<Act>, Automation | Pages | CurrentProject>;
type Emulate = typeof PAGE_OPERATIONS.emulate_page;
type EmulateCall = Effect.Effect<DeclaredAnswer<Emulate['answer']>, Refused<Emulate>, Automation | Pages | CurrentProject>;
const unused = () => Effect.die('this scenario does not use this port');
const PAGE = PageId.make('01a184cf-76ca-7d83-87c6-2f78805e2612');
const caller: Caller = {
  actor: { kind: 'thread', threadId: 'agent', projectId: 1, principalId: 'agent', session: { harness: 'tagma', key: 'agent' } },
  files: null,
};

const engine = Effect.fnUntraced(function* (mode: 'dialog' | 'detach' | 'conditions') {
  const incoming = yield* Queue.unbounded<string>();
  const started = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const adopting = yield* Deferred.make<void>();
  const adopted = yield* Deferred.make<void>();
  let latency = 0;
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
          readonly matchedNetworkConditions?: readonly { readonly latency: number }[];
        };
      };
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
      if (mode === 'conditions' && command.sessionId === 'child') {
        if (command.method === 'Emulation.setCPUThrottlingRate' && !Deferred.isDoneUnsafe(adopting)) {
          yield* Deferred.succeed(adopting, undefined);
          yield* Deferred.await(release);
        }
        if (command.method === 'Network.emulateNetworkConditionsByRule')
          latency = command.params?.matchedNetworkConditions?.[0]?.latency ?? 0;
        if (command.method === 'Page.getFrameTree') yield* Deferred.succeed(adopted, undefined);
      }
      const result =
        command.method === 'Runtime.evaluate'
          ? { result: { type: 'object', subtype: 'null', value: null } }
          : command.method === 'Page.createIsolatedWorld'
            ? { executionContextId: 1 }
            : command.method === 'Page.getFrameTree'
              ? {
                  frameTree: {
                    frame:
                      command.sessionId === 'child'
                        ? { id: 'child-frame', parentId: 'frame', loaderId: 'child-document', url: 'https://frame.example/' }
                        : { id: 'frame', loaderId: 'document', url: 'https://example.test/' },
                  },
                }
              : {};
      yield* Queue.offer(incoming, JSON.stringify({ id: command.id, result }));
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
      strain: () => (mode === 'conditions' ? Effect.void : unused()),
      geolocation: unused,
      answer: unused,
      events: unused(),
      paint: unused,
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
    profileOf: () => undefined,
    urlOf: () => record.url,
  });
  const profiles = Profiles.of({
    list: unused(),
    record: unused,
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
  const automation = yield* makeAutomation({ drive }).pipe(
    Effect.provideService(Pages, pages),
    Effect.provideService(Profiles, profiles),
    Effect.provideService(ThreadRuns, ThreadRuns.of({ running: () => Effect.succeed(true), ending: () => Effect.succeed(Effect.never) })),
    Effect.provideService(BrowserPlace, { root: '/browser' }),
    Effect.provideService(CheckoutPaths, yield* fixedCheckoutPaths(1, [])),
    Effect.provideService(ServedRoots, { root: unused }),
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
  return {
    act,
    started,
    pages,
    emulate,
    adopting,
    adopted,
    latency: () => latency,
    release: Deferred.succeed(release, undefined),
    join: Queue.offer(
      incoming,
      JSON.stringify({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: 'child',
          targetInfo: { targetId: 'child-frame', type: 'iframe', url: 'https://frame.example/' },
          waitingForDebugger: false,
        },
        sessionId: 'engine',
      }),
    ),
  };
});

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
