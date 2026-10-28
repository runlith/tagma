import { expect } from 'bun:test';
import * as BunPath from '@effect/platform-bun/BunPath';
import { connect } from '@runlith/cdp/session';
import { it } from '@runlith/effect-test';
import * as Memory from '@runlith/testbed/memory';
import { Deferred, Effect, Fiber, PubSub, Queue, Stream } from 'effect';
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
import { makeAutomation } from './engine/automation.js';
import { makeDrive } from './engine/drive.js';
import { PAGE_PAIRS } from './operations.js';

type Act = typeof PAGE_OPERATIONS.act_on_page;
type Call = Effect.Effect<DeclaredAnswer<Act['answer']>, Refused<Act>, Automation | Pages | CurrentProject>;
const unused = () => Effect.die('this scenario does not use this port');
const PAGE = PageId.make('01a184cf-76ca-7d83-87c6-2f78805e2612');
const caller: Caller = {
  actor: { kind: 'thread', threadId: 'agent', projectId: 1, principalId: 'agent', session: { harness: 'tagma', key: 'agent' } },
  files: null,
};

const engine = Effect.fnUntraced(function* (mode: 'dialog' | 'detach') {
  const incoming = yield* Queue.unbounded<string>();
  const started = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const connection = yield* connect({
    incoming: Stream.fromQueue(incoming),
    send: Effect.fnUntraced(function* (text) {
      const command = JSON.parse(text) as {
        readonly id: number;
        readonly method: string;
        readonly params?: { readonly type?: string; readonly key?: string };
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
      const result =
        command.method === 'Page.getFrameTree'
          ? { frameTree: { frame: { id: 'frame', loaderId: 'document', url: 'https://example.test/' } } }
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
      pdf: unused,
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
    live: () => live,
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
  const drive = yield* makeDrive({ pages, profiles, runs: ThreadRuns.of({ running: () => Effect.succeed(true) }) });
  const automation = yield* makeAutomation({ drive }).pipe(
    Effect.provideService(Pages, pages),
    Effect.provideService(Profiles, profiles),
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
  return { act, started, pages };
});

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
