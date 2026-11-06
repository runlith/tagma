import { humanInput, type HumanInput, type Pointer } from '@runlith/cdp/input';
import { type Domains, shareDomains } from '@runlith/cdp/domains';
import type { Ring } from '@runlith/cdp/ring';
import { type CdpEvent, type CommandFailure, eventParams, isCommandFailure, type Session, SessionEnded } from '@runlith/cdp/session';
import { Clock, Deferred, Effect, Exit, Fiber, PubSub, Scope, Semaphore, Stream } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { DriveRefusal } from '../contract/service/automation.js';
import { hostRefusal, type Pages } from '../contract/service/pages.js';
import type { ProfileRecord } from '../contract/service/hosts.js';
import type { Profiles } from '../contract/service/profiles.js';
import type { ThreadRuns } from '../contract/service/runs.js';
import { NO_EMULATION, type Emulation, type Viewport } from '../contract/wire/emulation.js';
import type { PageId, ProfileId } from '../contract/wire/ids.js';
import type { InputMode } from '../contract/wire/profile.js';
import type { ConsoleEntry, NetworkEntry } from '../contract/wire/rows.js';
import { capture, consoleRing, networkRing, type Request } from './capture.js';
import { makeChooser, type Chooser } from './chooser.js';
import type { Mark } from './cursor.js';
import { applyEmulation, effectiveOf, makeMetrics, type Metrics, nativeMetrics, resizedMetrics, syncMetrics } from './emulate.js';
import { type Frame, frameEvent, readTree } from './frames.js';
import { isLocal } from './local.js';
import { Refs } from './refs.js';
import { makePictures, type Pictures } from './pictures.js';
import { operatorQuiet } from './operator.js';
import { crashed, devtoolsOpen, ended, frameUnresponsive, inputMode, navigationBlocked, unknownPage, unresponsive } from './refusal.js';
import { drive } from '../../platform/contract/service/drives.js';

const IDLE_MS = 30_000;
const SWEEP = '10 seconds';

export type Picking = { readonly node: number; readonly child: string | undefined };

export type Attached = {
  readonly profile: ProfileId;
  readonly page: PageId;
  readonly session: Session;
  readonly input: InputMode;
  readonly human: HumanInput;
  readonly chooser: Chooser;
  readonly domains: Domains;
  readonly pictures: Pictures;
  readonly scope: Scope.Closeable;
  readonly frames: Map<string, Frame>;
  readonly children: Map<string, string>;
  readonly sessions: Map<string, string>;
  readonly through: Map<string, string>;
  readonly adopted: Map<string, Scope.Closeable>;
  readonly worlds: Map<string, number>;
  readonly picks: PubSub.PubSub<Picking>;
  readonly joined: PubSub.PubSub<string>;
  readonly settled: Set<string>;
  readonly syncEvents: () => Effect.Effect<void, SessionEnded>;
  main: string;
  navigations: number;
  runtime: Scope.Closeable | null;
  readonly syncing: Semaphore.Semaphore;
  group: string;
  conditions: Scope.Closeable | null;
  readonly metrics: Metrics;
  readonly emulating: Semaphore.Semaphore;
  overlaid: boolean;
  readonly overlaying: Semaphore.Semaphore;
  cursor: Mark | null;
};

type Attaching = {
  readonly revision: number;
  readonly input: InputMode;
  readonly scope: Scope.Closeable;
  readonly ready: Deferred.Deferred<Attached | null, Refusal>;
  fiber: Fiber.Fiber<void, Refusal> | null;
};

export type Paged = {
  readonly pointer: Pointer;
  readonly page: PageId;
  readonly queue: Semaphore.Semaphore;
  readonly console: Ring<ConsoleEntry>;
  readonly network: Ring<NetworkEntry>;
  readonly requests: Map<string, Request>;
  readonly refs: Refs;
  input: InputMode | null;
  asked: boolean;
  emulation: Emulation;
  layout: Viewport | null;
  attached: Attached | null;
  attaching: Attaching | null;
  retiring: Deferred.Deferred<void> | null;
  revision: number;
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
  readonly replays?: false;
  readonly agent?: boolean;
  readonly fast?: string;
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
          pointer: { at: { x: 0, y: 0 } },
          page,
          queue,
          console: consoleRing(),
          network: networkRing(),
          requests: new Map(),
          refs: new Refs(),
          input: null,
          asked: false,
          emulation: NO_EMULATION,
          layout: null,
          attached: null,
          attaching: null,
          retiring: null,
          revision: 0,
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
    if (attached.input === 'human') return false;
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
    const frame = yield* frameEvent(state, attached, event, pages);
    if (frame !== null) {
      if (frame !== 'handled') {
        yield* syncRuntime(state, attached);
        yield* PubSub.publish(attached.joined, frame.navigation);
      }
      return;
    }
    switch (event.method) {
      case 'Page.fileChooserOpened':
        return yield* attached.chooser.arrive(event);
      case 'Page.frameResized':
        return event.child === undefined ? yield* resizedMetrics(attached) : undefined;
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
    const retired = yield* Deferred.make<void>();
    if (state.retiring !== null) return yield* Deferred.await(state.retiring);
    const attached = state.attached;
    const pending = state.attaching;
    state.retiring = retired;
    state.attached = null;
    state.attaching = null;
    yield* Effect.gen(function* () {
      if (pending !== null) {
        yield* Deferred.succeed(pending.ready, null);
        if (pending.fiber !== null) yield* Fiber.interrupt(pending.fiber);
        yield* Scope.close(pending.scope, Exit.void);
      }
      if (attached !== null) yield* Scope.close(attached.scope, Exit.void);
      yield* drove(state, null);
    }).pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          yield* Deferred.done(retired, exit);
          if (state.retiring === retired) state.retiring = null;
        }),
      ),
    );
  }, Effect.uninterruptible);

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
    const domains =
      attached.input === 'human'
        ? (['Page', 'DOM', 'Accessibility'] as const)
        : (['Page', 'Network', 'DOM', 'Accessibility', 'Log'] as const);
    for (const domain of domains) yield* Scope.provide(attached.domains.enable(domain), attached.scope);
    yield* attached.session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    yield* readTree(attached, undefined);
    state.refs.keep(new Set([...attached.frames.values()].map((frame) => frame.loader)));
    yield* nativeMetrics(attached);
    if (attached.input === 'fast') yield* applyEmulation(attached, effectiveOf(state.emulation, state.layout));
    yield* syncMetrics(attached);
    yield* syncRuntime(state, attached);
  });

  const connect = Effect.fnUntraced(function* (
    state: Paged,
    thread: string | null,
    pending: Attaching,
  ): Effect.fn.Return<Attached | null, Refusal> {
    if (state.attaching !== pending) return null;
    const host = yield* pages.hold(state.page);
    const attachment = pending.scope;
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
      let admitted = 0;
      let applied = 0;
      let waiting: Deferred.Deferred<void> | null = null;
      let waitingThrough = 0;
      const events = yield* Scope.provide(
        session.events((method) => {
          if (method === 'Page.screencastFrame') return false;
          admitted += 1;
          return true;
        }),
        attachment,
      );
      const syncEvents = Effect.fn('browser.syncEvents')(function* () {
        const through = admitted;
        if (applied >= through) return;
        const ready = yield* Deferred.make<void>();
        if (applied >= through) return;
        waiting = ready;
        waitingThrough = through;
        yield* Effect.raceFirst(
          Deferred.await(ready),
          Effect.flatMap(session.ended, (end) =>
            Effect.fail(new SessionEnded({ message: 'the session ended before queued page events were applied', end, pending: false })),
          ),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (waiting === ready) waiting = null;
            }),
          ),
        );
      });
      const profile = pages.profileOf(state.page);
      if (profile === undefined) return yield* unknownPage(state.page);
      const attached: Attached = {
        profile,
        page: state.page,
        session,
        input: pending.input,
        human: humanInput(session, state.pointer),
        chooser: yield* Scope.provide(
          makeChooser(session, state.page, () => pages.operated(state.page)),
          attachment,
        ),
        domains,
        pictures: yield* Scope.provide(makePictures(session), attachment),
        scope: attachment,
        frames: new Map(),
        children: new Map(),
        sessions: new Map(),
        through: new Map(),
        adopted: new Map(),
        worlds: new Map(),
        picks: yield* PubSub.unbounded<Picking>(),
        joined: yield* PubSub.unbounded<string>(),
        settled: new Set(),
        syncEvents,
        main: '',
        navigations: 0,
        runtime: null,
        syncing: yield* Semaphore.make(1),
        group: 'engine',
        conditions: null,
        metrics: yield* Scope.provide(makeMetrics, attachment),
        emulating: yield* Semaphore.make(1),
        overlaid: false,
        overlaying: yield* Semaphore.make(1),
        cursor: null,
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
          Effect.tap(() =>
            Effect.suspend(() => {
              applied += 1;
              if (waiting === null || applied < waitingThrough) return Effect.void;
              const ready = waiting;
              waiting = null;
              return Deferred.succeed(ready, undefined);
            }),
          ),
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
    const profile = pages.profileOf(state.page);
    if (profile === undefined) return yield* unknownPage(state.page);
    const record = yield* profiles.record(profile);
    if (state.attaching !== pending || state.revision !== pending.revision || record.input !== pending.input) {
      yield* Scope.close(attachment, Exit.void);
      return null;
    }
    state.attached = opened;
    yield* drove(state, thread);
    return opened;
  });

  const attach = Effect.fnUntraced(function* (state: Paged, thread: string | null): Effect.fn.Return<Attached, Refusal> {
    for (;;) {
      if (state.retiring !== null) yield* Deferred.await(state.retiring);
      const revision = state.revision;
      const profile = pages.profileOf(state.page);
      if (profile === undefined) return yield* unknownPage(state.page);
      const record = yield* profiles.record(profile);
      if (state.revision !== revision) continue;
      if (state.input !== record.input) {
        yield* detach(state);
        state.emulation = NO_EMULATION;
        state.layout = null;
        state.input = record.input;
      }
      if (state.attached !== null) return state.attached;
      let pending = state.attaching;
      if (pending === null) {
        const life = yield* Scope.fork(scope);
        const ready = yield* Deferred.make<Attached | null, Refusal>();
        if (state.attaching !== null || state.retiring !== null || state.revision !== revision || state.input !== record.input) {
          yield* Scope.close(life, Exit.void);
          continue;
        }
        const next: Attaching = { revision: state.revision, input: record.input, scope: life, ready, fiber: null };
        state.attaching = next;
        pending = next;
        const fiber = yield* connect(state, thread, next).pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              if (Exit.isFailure(exit)) yield* Scope.close(next.scope, Exit.void);
              if (state.attaching !== next) return;
              state.attaching = null;
              yield* Deferred.done(ready, exit);
            }),
          ),
          Effect.asVoid,
          Effect.forkIn(scope),
        );
        next.fiber = fiber;
        if (state.attaching !== next && state.attached === null) yield* Fiber.interrupt(fiber);
      }
      const attached = yield* Deferred.await(pending.ready);
      if (attached !== null) return attached;
    }
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

  const fast = Effect.fn('browser.fast')(function* (page: PageId, action: string, attached: Attached | null) {
    const profile = pages.profileOf(page);
    if (profile === undefined) return yield* unknownPage(page);
    const record = yield* profiles.record(profile);
    if (record.input === 'human' || attached?.input === 'human') return yield* inputMode(profile, action);
  });

  const guard = Effect.fnUntraced(function* <A, E>(
    state: Paged,
    thread: string | null,
    attaching: boolean,
    work: (state: Paged, attached: Attached | null) => Effect.Effect<A, E>,
    recovers: boolean,
    options: DriveOptions<A> = {},
  ): Effect.fn.Return<A, Exclude<E, CommandFailure> | Refusal, Scope.Scope> {
    const page = state.page;
    const moves = yield* pages.moves(page);
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
    const guarded = Effect.gen(function* () {
      const attempt = Effect.gen(function* () {
        yield* gate(state, recovers);
        const live = pages.live(page);
        const unavailable = live?.responsive === false || live?.crashed === true;
        if (options.agent === true) yield* operatorQuiet(pages, page);
        const navigation = options.agent === undefined ? null : yield* pages.navigation(page, options.agent);
        const attached = unavailable ? null : attaching ? yield* attach(state, thread) : state.attached;
        if (options.fast !== undefined) yield* fast(page, options.fast, attached);
        state.used = yield* Clock.currentTimeMillis;
        if (thread !== null) state.driver = thread;
        const working = Effect.gen(function* () {
          if (navigation !== null) yield* navigation.check.pipe(Effect.mapError(navigationBlocked));
          if (options.agent === true)
            yield* operatorQuiet(pages, page).pipe(Effect.tapError(() => Effect.scoped(pages.navigation(page, false))));
          let answer: A;
          if (attached === null) answer = yield* work(state, attached);
          else {
            yield* syncMetrics(attached);
            if (thread !== null) yield* drove(state, thread);
            groups += 1;
            const group = `engine-${groups}`;
            attached.group = group;
            answer = yield* work(state, attached).pipe(Effect.ensuring(Effect.forkIn(release(attached, group), attached.scope)));
          }
          if (navigation !== null) yield* navigation.check.pipe(Effect.mapError(navigationBlocked));
          return answer;
        });
        const checked = working.pipe(
          Effect.tapError(() => (navigation === null ? Effect.void : navigation.check.pipe(Effect.mapError(navigationBlocked)))),
        );
        return yield* navigation === null
          ? checked
          : Effect.raceFirst(checked, navigation.blocked.pipe(Effect.mapError(navigationBlocked)));
      });
      const swapped = (failure: unknown): boolean =>
        options.replays !== false &&
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
    });
    return yield* Effect.raceFirst(guarded, blocked);
  });

  const run = Effect.fnUntraced(function* <A, E>(
    page: PageId,
    thread: string | null,
    attaching: boolean,
    work: (state: Paged, attached: Attached | null) => Effect.Effect<A, E>,
    options: DriveOptions<A> = {},
  ): Effect.fn.Return<A, Exclude<E, CommandFailure> | Refusal> {
    const state = yield* paged(page);
    const initial = pages.live(page);
    const recovers = options.recovers === true && (initial?.responsive === false || initial?.crashed === true);
    state.busy += 1;
    return yield* Effect.scoped(state.queue.withPermits(1)(guard(state, thread, attaching, work, recovers, options))).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          state.busy -= 1;
        }),
      ),
    );
  });

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

  const resync = Effect.fnUntraced(function* (record: ProfileRecord) {
    const states = [...held.values()].filter((state) => pages.profileOf(state.page) === record.id);
    for (const state of states) state.revision += 1;
    yield* Effect.forEach(
      states,
      (state) =>
        state.queue.withPermits(1)(
          Effect.gen(function* () {
            if (record.input !== state.input || state.attaching !== null) {
              const changed = record.input !== state.input;
              yield* detach(state);
              if (changed) {
                state.emulation = NO_EMULATION;
                state.layout = null;
              }
              state.input = record.input;
            } else if (state.attached !== null) yield* syncRuntime(state, state.attached);
          }).pipe(
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
  });

  yield* Effect.flatMap(profiles.changes, (changes) => Stream.runForEach(changes, resync)).pipe(Effect.forkScoped);

  return {
    read: Effect.fnUntraced(function* <A>(page: PageId, action: string, work: (state: Paged) => A) {
      const state = yield* paged(page);
      return yield* state.queue.withPermits(1)(
        Effect.gen(function* () {
          if (pages.live(page) === undefined) return yield* unknownPage(page);
          yield* fast(page, action, null);
          return work(state);
        }),
      );
    }),
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
