import { type Domains, shareDomains } from '@runlith/cdp/domains';
import type { Ring } from '@runlith/cdp/ring';
import { watchResponsive } from '@runlith/cdp/probe';
import { type CdpEvent, type CommandFailure, eventParams, isCommandFailure, type Session, SessionEnded } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Clock, Deferred, Effect, Exit, PubSub, Scope, Semaphore, Stream } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { DriveRefusal } from '../contract/service/automation.js';
import { type FrameTarget, hostRefusal, type Pages } from '../contract/service/pages.js';
import type { Profiles } from '../contract/service/profiles.js';
import type { ThreadRuns } from '../contract/service/runs.js';
import { NO_EMULATION, type Emulation, type Viewport } from '../contract/wire/emulation.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import type { ConsoleEntry, NetworkEntry } from '../contract/wire/rows.js';
import { capture, consoleRing, networkRing, type Request } from './capture.js';
import { applyEmulation, effectiveOf } from './emulate.js';
import { isLocal } from './local.js';
import { Refs } from './refs.js';
import { crashed, devtoolsOpen, ended, frameUnresponsive, unknownPage, unresponsive } from './refusal.js';
import { drive } from '../../platform/contract/service/drives.js';

const IDLE_MS = 30_000;
const SWEEP = '10 seconds';

export type Frame = { readonly loader: string; readonly child: string | undefined; readonly url: string; readonly parent: string | null };

export type Picking = { readonly node: number; readonly child: string | undefined };

export type Attached = {
  readonly page: PageId;
  readonly session: Session;
  readonly domains: Domains;
  readonly scope: Scope.Closeable;
  readonly frames: Map<string, Frame>;
  readonly children: Map<string, string>;
  readonly adopted: Map<string, Scope.Closeable>;
  readonly worlds: Map<string, number>;
  readonly picks: PubSub.PubSub<Picking>;
  readonly joined: PubSub.PubSub<string>;
  readonly settled: Set<string>;
  main: string;
  navigations: number;
  runtime: Scope.Closeable | null;
  readonly syncing: Semaphore.Semaphore;
  group: string;
};

export type Paged = {
  readonly page: PageId;
  readonly queue: Semaphore.Semaphore;
  readonly console: Ring<ConsoleEntry>;
  readonly network: Ring<NetworkEntry>;
  readonly requests: Map<string, Request>;
  readonly refs: Refs;
  asked: boolean;
  emulation: Emulation;
  layout: Viewport | null;
  attached: Attached | null;
  attaching: Deferred.Deferred<Attached, Refusal> | null;
  used: number;
  busy: number;
  picking: number;
  watching: number;
  driver: string | null;
  driven: string | null;
};

export type Refusal = StoreFailure | GateRefusal<DriveRefusal>;

export type DriveOptions<A> = {
  readonly opened?: (page: PageId) => Effect.Effect<A>;
  readonly recovers?: true;
};

export const makeDrive = Effect.fnUntraced(function* (input: {
  readonly pages: Pages['Service'];
  readonly profiles: Profiles['Service'];
  readonly runs: ThreadRuns['Service'];
}) {
  const { pages, profiles, runs } = input;
  const scope = yield* Effect.scope;
  const held = new Map<PageId, Paged>();

  const paged = (page: PageId): Effect.Effect<Paged> =>
    Effect.suspend(() => {
      const known = held.get(page);
      if (known !== undefined) return Effect.succeed(known);
      return Effect.map(Semaphore.make(1), (queue) => {
        const fresh: Paged = {
          page,
          queue,
          console: consoleRing(),
          network: networkRing(),
          requests: new Map(),
          refs: new Refs(),
          asked: false,
          emulation: NO_EMULATION,
          layout: null,
          attached: null,
          attaching: null,
          used: 0,
          busy: 0,
          picking: 0,
          watching: 0,
          driver: null,
          driven: null,
        };
        held.set(page, held.get(page) ?? fresh);
        return held.get(page)!;
      });
    });

  const wantsRuntime = Effect.fnUntraced(function* (state: Paged, attached: Attached) {
    const profile = pages.profileOf(state.page);
    if (profile === undefined) return false;
    const record = yield* Effect.orDie(profiles.record(profile).pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null))));
    if (record === null) return false;
    if (record.console === 'always') return true;
    if (record.console === 'never') return false;
    return state.asked || isLocal(attached.frames.get(attached.main)?.url ?? pages.urlOf(state.page));
  });

  const syncRuntime = (state: Paged, attached: Attached) =>
    attached.syncing.withPermits(1)(
      Effect.gen(function* () {
        const want = yield* wantsRuntime(state, attached);
        if (want && attached.runtime === null) {
          const runtime = yield* Scope.fork(attached.scope);
          attached.runtime = runtime;
          yield* Scope.provide(attached.domains.enable('Runtime'), runtime);
          for (const child of attached.children.keys()) yield* Scope.provide(attached.domains.enable('Runtime', child), runtime);
        } else if (!want && attached.runtime !== null) {
          const runtime = attached.runtime;
          attached.runtime = null;
          yield* Scope.close(runtime, Exit.void);
        }
      }),
    );

  const readTree = Effect.fnUntraced(function* (attached: Attached, child: string | undefined) {
    const { frameTree } = yield* attached.session.send('Page.getFrameTree', undefined, child);
    const walk = (tree: Protocol.Page.FrameTree): void => {
      const parent = tree.frame.parentId ?? attached.frames.get(tree.frame.id)?.parent ?? null;
      attached.frames.set(tree.frame.id, { loader: tree.frame.loaderId, child, url: tree.frame.url, parent });
      for (const nested of tree.childFrames ?? []) walk(nested);
    };
    walk(frameTree);
    if (child === undefined) attached.main = frameTree.frame.id;
  });

  const adoptChild = Effect.fnUntraced(function* (attached: Attached, child: string, adopted: Scope.Closeable) {
    for (const domain of ['Page', 'DOM', 'Network', 'Log', 'Accessibility'] as const)
      yield* Scope.provide(attached.domains.enable(domain, child), adopted);
    if (attached.runtime !== null) yield* Scope.provide(attached.domains.enable('Runtime', child), attached.runtime);
    yield* attached.session.send('Emulation.setFocusEmulationEnabled', { enabled: true }, child);
    yield* attached.session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, child);
    yield* readTree(attached, child);
  });

  const navigated = Effect.fnUntraced(function* (state: Paged, attached: Attached, frame: Protocol.Page.Frame, child: string | undefined) {
    const before = attached.frames.get(frame.id);
    if (before !== undefined && before.loader !== frame.loaderId) {
      state.refs.retire(before.loader);
      attached.worlds.delete(`${frame.id}|${before.loader}`);
    }
    attached.frames.set(frame.id, { loader: frame.loaderId, child, url: frame.url, parent: frame.parentId ?? before?.parent ?? null });
    if (frame.parentId === undefined && child === undefined) {
      attached.main = frame.id;
      yield* syncRuntime(state, attached);
    }
    yield* PubSub.publish(attached.joined, frame.id);
  });

  const syncNavigation = Effect.fnUntraced(function* (attached: Attached) {
    const moved = yield* PubSub.subscribe(attached.joined);
    const stopped = Effect.flatMap(attached.session.ended, (end) =>
      ended(
        attached.page,
        new SessionEnded({ message: 'the session ended before the engine observed navigation commit', end, pending: false }),
      ),
    );
    for (;;) {
      const { frameTree } = yield* attached.session
        .send('Page.getFrameTree')
        .pipe(Effect.catchIf(isCommandFailure, (failure) => ended(attached.page, failure)));
      if (attached.frames.get(frameTree.frame.id)?.loader === frameTree.frame.loaderId) return;
      yield* Effect.raceFirst(PubSub.take(moved), stopped);
    }
  }, Effect.scoped);

  const onEvent = Effect.fnUntraced(function* (state: Paged, attached: Attached, event: CdpEvent) {
    switch (event.method) {
      case 'Page.frameNavigated': {
        const { frame } = yield* eventParams('Page.frameNavigated', event);
        return yield* navigated(state, attached, frame, event.child);
      }
      case 'Page.frameStartedNavigating': {
        const { frameId } = yield* eventParams('Page.frameStartedNavigating', event);
        if (frameId !== attached.main || event.child !== undefined) return;
        attached.navigations += 1;
        return yield* PubSub.publish(attached.joined, frameId);
      }
      case 'Page.frameDetached': {
        const { frameId, reason } = yield* eventParams('Page.frameDetached', event);
        const gone = attached.frames.get(frameId);
        if (reason === 'swap' || gone?.child !== event.child) return;
        attached.frames.delete(frameId);
        if (gone !== undefined) {
          state.refs.retire(gone.loader);
          attached.worlds.delete(`${frameId}|${gone.loader}`);
        }
        return yield* PubSub.publish(attached.joined, frameId);
      }
      case 'Page.javascriptDialogOpening': {
        const opened = yield* eventParams('Page.javascriptDialogOpening', event);
        return yield* pages.mark(state.page, {
          dialog: {
            kind: opened.type,
            message: opened.message,
            prompt: opened.type === 'prompt' ? (opened.defaultPrompt ?? '') : null,
            url: opened.url,
          },
        });
      }
      case 'Page.javascriptDialogClosed':
        return yield* pages.mark(state.page, { dialog: null });
      case 'Overlay.inspectNodeRequested': {
        const { backendNodeId } = yield* eventParams('Overlay.inspectNodeRequested', event);
        return yield* PubSub.publish(attached.picks, { node: backendNodeId, child: event.child });
      }
      case 'Target.attachedToTarget': {
        const joined = yield* eventParams('Target.attachedToTarget', event);
        if (joined.targetInfo.type !== 'iframe') {
          yield* Effect.exit(attached.session.send('Target.detachFromTarget', { sessionId: joined.sessionId }));
          return;
        }
        attached.children.set(joined.sessionId, joined.targetInfo.targetId);
        const adopted = yield* Scope.fork(attached.scope);
        attached.adopted.set(joined.sessionId, adopted);
        const target: FrameTarget = { session: joined.sessionId, frame: joined.targetInfo.targetId, url: joined.targetInfo.url };
        yield* Scope.addFinalizer(adopted, pages.mark(state.page, { responsive: true }, target));
        yield* watchResponsive(
          attached.session,
          { every: '1 second', threshold: '5 seconds', paused: () => pages.live(state.page)?.dialog !== null, child: joined.sessionId },
          (responsive) => pages.mark(state.page, { responsive }, { ...target, url: attached.frames.get(target.frame)?.url ?? target.url }),
        ).pipe(Effect.forkIn(adopted));
        yield* adoptChild(attached, joined.sessionId, adopted).pipe(
          Effect.catchTags({
            SessionEnded: () => Effect.void,
            CommandRefused: (refused) =>
              Effect.logDebug(`browser: an out-of-process frame of ${state.page} was not adopted: ${refused.method}: ${refused.message}`),
          }),
          Effect.ensuring(
            Effect.suspend(() => {
              attached.settled.add(joined.targetInfo.targetId);
              return PubSub.publish(attached.joined, joined.targetInfo.targetId);
            }),
          ),
          Effect.forkIn(adopted),
        );
        return;
      }
      case 'Target.detachedFromTarget': {
        const { sessionId } = yield* eventParams('Target.detachedFromTarget', event);
        if (sessionId === undefined || !attached.children.has(sessionId)) return;
        const gone = attached.children.get(sessionId)!;
        attached.settled.delete(gone);
        attached.children.delete(sessionId);
        yield* PubSub.publish(attached.joined, gone);
        for (const [frame, held] of attached.frames) if (held.child === sessionId) attached.frames.delete(frame);
        const adopted = attached.adopted.get(sessionId);
        attached.adopted.delete(sessionId);
        if (adopted !== undefined) yield* Scope.close(adopted, Exit.void);
        return;
      }
      default:
        return yield* capture(state, attached, event);
    }
  });

  const drove = (state: Paged, thread: string | null) =>
    Effect.suspend(() => {
      if (state.driven === thread) return Effect.void;
      state.driven = thread;
      return pages.mark(state.page, { driven: thread });
    });

  const detach = Effect.fnUntraced(function* (state: Paged) {
    const attached = state.attached;
    if (attached === null) return;
    state.attached = null;
    yield* Scope.close(attached.scope, Exit.void);
    yield* drove(state, null);
  });

  const retake = Effect.fnUntraced(
    function* (state: Paged) {
      const moves = yield* pages.moves(state.page);
      yield* detach(state);
      const released = yield* Stream.runHead(Stream.filter(moves, (move) => move.signal === 'released' || move.signal === 'closed'));
      if (released._tag === 'None' || released.value.signal === 'closed') return;
      yield* attach(state, state.driver).pipe(
        Effect.catchTag('GateRefusal', (refused) =>
          Effect.logInfo(`browser: page ${state.page} was not taken back after DevTools closed: ${refused.reason}`),
        ),
        Effect.orDie,
      );
    },
    Effect.scoped,
    (effect) => Effect.forkIn(effect, scope),
    Effect.asVoid,
  );

  const setup = Effect.fnUntraced(function* (state: Paged, attached: Attached) {
    yield* attached.session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    for (const domain of ['Page', 'Network', 'DOM', 'Accessibility', 'Log'] as const)
      yield* Scope.provide(attached.domains.enable(domain), attached.scope);
    yield* attached.session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    yield* readTree(attached, undefined);
    state.refs.keep(new Set([...attached.frames.values()].map((frame) => frame.loader)));
    yield* applyEmulation(attached.session, effectiveOf(state.emulation, state.layout));
    yield* syncRuntime(state, attached);
  });

  const connect = Effect.fnUntraced(function* (state: Paged, thread: string | null): Effect.fn.Return<Attached, Refusal> {
    const host = yield* pages.hold(state.page);
    const attachment = yield* Scope.fork(scope);
    const opened = yield* Effect.gen(function* () {
      const session = yield* Scope.provide(host.pages.session(state.page), attachment).pipe(
        Effect.catchTags({
          DebuggerTaken: () => Effect.fail(devtoolsOpen(state.page)),
          PageMissing: () => Effect.fail(unknownPage(state.page)),
          HostLost: (lost) => Effect.fail(hostRefusal(lost)),
          HostRefused: (refused) => Effect.fail(hostRefusal(refused)),
        }),
      );
      const domains = yield* Scope.provide(shareDomains(session), attachment);
      const events = yield* Scope.provide(
        session.events((method) => method !== 'Page.screencastFrame'),
        attachment,
      );
      const attached: Attached = {
        page: state.page,
        session,
        domains,
        scope: attachment,
        frames: new Map(),
        children: new Map(),
        adopted: new Map(),
        worlds: new Map(),
        picks: yield* PubSub.unbounded<Picking>(),
        joined: yield* PubSub.unbounded<string>(),
        settled: new Set(),
        main: '',
        navigations: 0,
        runtime: null,
        syncing: yield* Semaphore.make(1),
        group: 'engine',
      };
      yield* Stream.runForEach(events, (event) =>
        onEvent(state, attached, event).pipe(
          Effect.catchTags({
            PayloadUnreadable: (unreadable) =>
              Effect.logWarning(`browser: an event of page ${state.page} was unreadable: ${unreadable.message}`),
            WorkerUnavailable: (gone) => Effect.logWarning(`browser: an event of page ${state.page} was not read: ${gone.message}`),
            SessionEnded: () => Effect.void,
            CommandRefused: (refused) => Effect.logDebug(`browser: page ${state.page} refused ${refused.method}: ${refused.message}`),
          }),
        ),
      ).pipe(Effect.forkIn(attachment));
      yield* Effect.flatMap(session.ended, (end) =>
        state.attached !== attached ? Effect.void : end === 'taken' ? retake(state) : detach(state),
      ).pipe(Effect.forkIn(scope));
      yield* setup(state, attached).pipe(
        Effect.catchTags({
          CommandRefused: (failure) => ended(state.page, failure),
          SessionEnded: (failure) => ended(state.page, failure),
          PayloadUnreadable: (failure) => ended(state.page, failure),
          WorkerUnavailable: (failure) => ended(state.page, failure),
        }),
      );
      return attached;
    }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(attachment, Exit.void) : Effect.void)));
    state.attached = opened;
    yield* drove(state, thread);
    return opened;
  });

  const attach = Effect.fnUntraced(function* (state: Paged, thread: string | null): Effect.fn.Return<Attached, Refusal> {
    if (state.attached !== null) return state.attached;
    if (state.attaching !== null) return yield* Deferred.await(state.attaching);
    const attaching = yield* Deferred.make<Attached, Refusal>();
    state.attaching = attaching;
    yield* connect(state, thread).pipe(
      Effect.onExit((exit) =>
        Effect.andThen(
          Deferred.done(attaching, exit),
          Effect.sync(() => {
            state.attaching = null;
          }),
        ),
      ),
      Effect.forkIn(scope),
    );
    return yield* Deferred.await(attaching);
  });

  let groups = 0;

  const release = (attached: Attached, group: string) =>
    Effect.forEach(
      [undefined, ...attached.children.keys()],
      (child) =>
        attached.session.send('Runtime.releaseObjectGroup', { objectGroup: group }, child).pipe(
          Effect.catchTags({
            SessionEnded: () => Effect.void,
            CommandRefused: () => Effect.void,
            PayloadUnreadable: () => Effect.void,
            WorkerUnavailable: () => Effect.void,
          }),
        ),
      { discard: true },
    );

  const frameRefusal = (state: Paged) => {
    const frame = pages.hungFrame(state.page);
    const profile = pages.profileOf(state.page);
    return frame === undefined
      ? undefined
      : frameUnresponsive(state.page, `${frame.frame} (${frame.url})`, profile === undefined ? [] : pages.inProfile(profile));
  };

  const gate = (state: Paged, recovers: boolean): Effect.Effect<void, GateRefusal<DriveRefusal>> => {
    const page = state.page;
    const live = pages.live(page);
    if (live === undefined) return Effect.fail(unknownPage(page));
    if (live.crashed && !recovers) return Effect.fail(crashed(page));
    const frame = frameRefusal(state);
    if (frame !== undefined) return Effect.fail(frame);
    if (!live.responsive && !recovers) return Effect.fail(unresponsive(page));
    if (live.dialog !== null) {
      return Effect.fail(
        new GateRefusal('dialog-open', `a ${live.dialog.kind} dialog is open on page ${page}: ${JSON.stringify(live.dialog.message)}`, [
          'answer_page_dialog — accept or dismiss it first',
        ]),
      );
    }
    return Effect.void;
  };

  const guard = Effect.fnUntraced(function* <A, E>(
    page: PageId,
    thread: string | null,
    attaching: boolean,
    work: (state: Paged, attached: Attached | null) => Effect.Effect<A, E>,
    options: DriveOptions<A> = {},
  ): Effect.fn.Return<A, Exclude<E, CommandFailure> | Refusal, Scope.Scope> {
    const state = yield* paged(page);
    const moves = yield* pages.moves(page);
    const initial = pages.live(page);
    const recovers = options.recovers === true && (initial?.responsive === false || initial?.crashed === true);
    const blocked = Stream.runHead(
      moves.pipe(
        Stream.map((move) => ({ move, frame: frameRefusal(state) })),
        Stream.filter(
          ({ move, frame }) =>
            move.signal === 'closed' ||
            frame !== undefined ||
            (!recovers && (!move.live.responsive || move.live.crashed)) ||
            (options.opened !== undefined && move.live.dialog !== null),
        ),
      ),
    ).pipe(
      Effect.flatMap((result): Effect.Effect<A, Refusal> => {
        if (result._tag === 'None' || result.value.move.signal === 'closed') return Effect.fail(unknownPage(page));
        const { move, frame } = result.value;
        if (!recovers && move.live.crashed) return Effect.fail(crashed(page));
        if (frame !== undefined) return Effect.fail(frame);
        if (!recovers && !move.live.responsive) return Effect.fail(unresponsive(page));
        return options.opened === undefined ? Effect.fail(unknownPage(page)) : options.opened(page);
      }),
    );
    const guarded = state.queue.withPermits(1)(
      Effect.gen(function* () {
        const attempt = Effect.gen(function* () {
          yield* gate(state, recovers);
          const live = pages.live(page);
          const unavailable = live?.responsive === false || live?.crashed === true;
          const attached = unavailable ? null : attaching ? yield* attach(state, thread) : state.attached;
          state.used = yield* Clock.currentTimeMillis;
          if (thread !== null) state.driver = thread;
          if (attached === null) return yield* work(state, attached);
          if (thread !== null) yield* drove(state, thread);
          groups += 1;
          const group = `engine-${groups}`;
          attached.group = group;
          return yield* work(state, attached).pipe(Effect.ensuring(Effect.forkIn(release(attached, group), attached.scope)));
        });
        const swapped = (failure: unknown): boolean =>
          attaching &&
          isCommandFailure(failure) &&
          failure._tag === 'SessionEnded' &&
          failure.end === 'detached' &&
          failure.child === undefined &&
          pages.live(page) !== undefined;
        return yield* attempt.pipe(
          Effect.catchIf(swapped, () => Effect.andThen(detach(state), attempt)),
          Effect.catch((failure): Effect.Effect<never, Exclude<E, CommandFailure> | GateRefusal<DriveRefusal>> =>
            isCommandFailure(failure) ? ended(page, failure) : Effect.fail(failure as Exclude<E, CommandFailure>),
          ),
        );
      }),
    );
    state.busy += 1;
    return yield* Effect.raceFirst(guarded, blocked).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          state.busy -= 1;
        }),
      ),
    );
  });

  const run = <A, E>(
    page: PageId,
    thread: string | null,
    attaching: boolean,
    work: (state: Paged, attached: Attached | null) => Effect.Effect<A, E>,
    options: DriveOptions<A> = {},
  ): Effect.Effect<A, Exclude<E, CommandFailure> | Refusal> => Effect.scoped(guard(page, thread, attaching, work, options));

  const sweep = Effect.fnUntraced(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const state of held.values()) {
      if (pages.live(state.page) === undefined) {
        yield* detach(state);
        held.delete(state.page);
        continue;
      }
      if (state.driven !== null && state.busy === 0 && now - state.used >= IDLE_MS && !(yield* runs.running(state.driven)))
        yield* drove(state, null);
      if (
        state.attached === null ||
        state.picking > 0 ||
        state.watching > 0 ||
        state.busy > 0 ||
        pages.live(state.page)?.shown === true ||
        now - state.used < IDLE_MS
      )
        continue;
      if (state.driver !== null && (yield* runs.running(state.driver))) continue;
      yield* detach(state);
    }
  });

  yield* drive('browser-idle-pages', Effect.forever(Effect.andThen(Effect.sleep(SWEEP), sweep())));

  const resync = (profile: ProfileId) =>
    Effect.forEach(
      [...held.values()].filter((state) => pages.profileOf(state.page) === profile),
      (state) =>
        state.queue.withPermits(1)(
          Effect.suspend(() => (state.attached === null ? Effect.void : syncRuntime(state, state.attached))).pipe(
            Effect.catchTags({
              SessionEnded: () => Effect.void,
              CommandRefused: (refused) => Effect.logDebug(`browser: page ${state.page} refused ${refused.method}: ${refused.message}`),
              PayloadUnreadable: (unreadable) =>
                Effect.logWarning(`browser: page ${state.page} answered unreadably: ${unreadable.message}`),
              WorkerUnavailable: (gone) => Effect.logWarning(`browser: an answer of page ${state.page} was not read: ${gone.message}`),
            }),
          ),
        ),
      { discard: true },
    );

  yield* Effect.flatMap(profiles.changes, (changes) => Stream.runForEach(changes, resync)).pipe(Effect.forkScoped);

  return {
    paged,
    attach,
    detach,
    run,
    syncNavigation,
    syncRuntime,
    drive: <A, E>(
      page: PageId,
      thread: string | null,
      work: (state: Paged, attached: Attached) => Effect.Effect<A, E>,
      options: DriveOptions<A> = {},
    ) =>
      run<A, E>(
        page,
        thread,
        true,
        (state, attached) => (attached === null ? Effect.die('the page was not attached') : work(state, attached)),
        options,
      ),
  };
});

export type Drive = Effect.Success<ReturnType<typeof makeDrive>>;
