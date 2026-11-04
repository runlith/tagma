import { TEXT_CHUNK } from '@runlith/cdp/input';
import { keyOf, MODIFIERS } from '@runlith/cdp/keys';
import { castFrame, sliceData } from '@runlith/cdp/screencast';
import {
  type CdpEvent,
  type CommandFailure,
  eventParams,
  isCommandFailure,
  type Method,
  type SendArgs,
  type Session,
  type SessionEnded,
} from '@runlith/cdp/session';
import { Cause, Clock, Deferred, Effect, Exit, FileSystem, Path, Scope, Semaphore, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { DriveRefusal } from '../contract/service/automation.js';
import { hostRefusal, type Pages } from '../contract/service/pages.js';
import { BrowserPlace, chosenOf } from '../contract/service/place.js';
import { Screencast } from '../contract/service/screencast.js';
import type { Viewport } from '../contract/wire/emulation.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Budget, Chosen, Frame, InputEvent, ScreencastEvent } from '../contract/wire/screencast.js';
import type { Attached, Drive, Paged, Refusal } from './drive.js';
import { applyEmulation, effectiveOf } from './emulate.js';
import { ended, unknownPage } from './refusal.js';
import { world } from './target.js';

const EVICT_MS = 10_000;
const FIRST_FRAME = '1 second';
const QUALITY = 70;
const LAYOUT_MIN = 200;
const LAYOUT_MAX = 4000;

const BUTTON_BITS = { none: 0, left: 1, right: 2, middle: 4 } as const;

const EDITING: Readonly<Record<string, readonly string[]>> = { KeyA: ['selectAll'], KeyZ: ['undo'] };

const SELECTION = `(() => {
  let view = window;
  let active = document.activeElement;
  while (active && (active.localName === 'iframe' || active.localName === 'frame')) {
    let inner = null;
    try { inner = active.contentWindow && active.contentWindow.document; } catch {}
    if (!inner) break;
    view = active.contentWindow;
    active = inner.activeElement;
  }
  const field = active && (active.localName === 'textarea' || (active.localName === 'input' && /^(text|search|url|tel|email|number)$/i.test(active.type)));
  if (field && active.selectionStart !== null) return active.value.slice(active.selectionStart, active.selectionEnd);
  return String(view.getSelection());
})()`;

type Params = {
  readonly format: 'jpeg';
  readonly quality: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly everyNthFrame: number;
};

type Held = { readonly event: Frame; readonly ack: number | null; readonly at: number };

export type Shot = { readonly data: string; readonly at: number };

type Viewer = {
  readonly id: string;
  readonly keep: boolean;
  budget: Budget;
  readonly notices: ScreencastEvent[];
  frame: Held | null;
  wake: Deferred.Deferred<void> | null;
  ending: GateRefusal<DriveRefusal> | 'evicted' | null;
  stalled: number | null;
  received: number;
  next: number;
  readonly turns: Map<number, Deferred.Deferred<void, GateRefusal<'viewer-unknown'>>>;
  buttons: number;
};

type Chooser = { readonly node: number; readonly child: string | undefined; readonly multiple: boolean };

type Cast = {
  readonly page: PageId;
  readonly state: Paged;
  readonly viewers: Map<string, Viewer>;
  readonly lock: Semaphore.Semaphore;
  life: Scope.Closeable | null;
  held: Scope.Scope | null;
  attached: Attached | null;
  native: boolean;
  params: Params | null;
  last: Held | null;
  pending: number | null;
  arrived: number;
  chooser: Chooser | null;
  tuning: boolean;
};

const clamp = (value: number): number => Math.min(LAYOUT_MAX, Math.max(LAYOUT_MIN, Math.round(value)));

const paramsOf = (viewers: Iterable<Viewer>): Params => {
  let maxWidth = Number.POSITIVE_INFINITY;
  let maxHeight = Number.POSITIVE_INFINITY;
  let quality = 100;
  let everyNthFrame = 1;
  for (const { budget } of viewers) {
    maxWidth = Math.min(maxWidth, Math.round(budget.width * budget.scale));
    maxHeight = Math.min(maxHeight, Math.round(budget.height * budget.scale));
    quality = Math.min(quality, budget.quality ?? QUALITY);
    everyNthFrame = Math.max(everyNthFrame, budget.every ?? 1);
  }
  return { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame };
};

const sameParams = (a: Params | null, b: Params): boolean =>
  a !== null && a.quality === b.quality && a.maxWidth === b.maxWidth && a.maxHeight === b.maxHeight && a.everyNthFrame === b.everyNthFrame;

const layoutOf = (cast: Cast | undefined): Viewport | null => {
  if (cast === undefined || cast.native || cast.attached === null) return null;
  for (const { budget } of cast.viewers.values()) {
    if (budget.layout === true) return { width: clamp(budget.width), height: clamp(budget.height), scale: 1, mobile: false };
  }
  return null;
};

const sameLayout = (a: Viewport | null, b: Viewport | null): boolean =>
  a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height && a.scale === b.scale);

const pressed = (buttons: number): 'none' | 'left' | 'middle' | 'right' =>
  buttons & 1 ? 'left' : buttons & 2 ? 'right' : buttons & 4 ? 'middle' : 'none';

const operates = (event: InputEvent, buttons: number): boolean =>
  event.kind === 'mouse' ? event.type !== 'move' || buttons !== 0 : event.kind !== 'copy' && event.kind !== 'view';

const viewerUnknown = (viewer: string) =>
  new GateRefusal('viewer-unknown', `viewer ${viewer} no longer watches this page`, ['subscribe to browser.screencast again']);

const noChooser = (page: PageId) =>
  new GateRefusal('no-chooser', `page ${page} is not asking for a file`, ['click the file field on the page first']);

export const makeScreencast = Effect.fnUntraced(function* (input: { readonly pages: Pages['Service']; readonly drive: Drive }) {
  const { pages, drive } = input;
  const place = yield* BrowserPlace;
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const casts = new Map<PageId, Cast>();
  let named = 0;

  const wake = (viewer: Viewer) => {
    const waiting = viewer.wake;
    viewer.wake = null;
    if (waiting !== null) Deferred.doneUnsafe(waiting, Exit.void);
  };

  const notice = (cast: Cast, event: ScreencastEvent) => {
    for (const viewer of cast.viewers.values()) {
      if (viewer.keep) continue;
      viewer.notices.push(event);
      wake(viewer);
    }
  };

  const deliver = (cast: Cast, held: Held, now: number): boolean => {
    cast.last = held;
    let evicted = false;
    for (const viewer of cast.viewers.values()) {
      if (viewer.frame !== null && viewer.stalled === null) viewer.stalled = now;
      if (!viewer.keep && viewer.received > 0 && viewer.stalled !== null && now - viewer.stalled >= EVICT_MS) {
        cast.viewers.delete(viewer.id);
        viewer.ending = 'evicted';
        viewer.frame = null;
        evicted = true;
      } else viewer.frame = held;
      wake(viewer);
    }
    return evicted;
  };

  const settled = (cast: Cast): Effect.Effect<void> =>
    cast.lock.withPermits(1)(
      Effect.suspend(() => {
        cast.tuning = false;
        if (cast.viewers.size > 0) return tune(cast);
        if (cast.life !== null) return stop(cast);
        if (casts.get(cast.page) === cast) casts.delete(cast.page);
        return Effect.void;
      }),
    );

  const close = (cast: Cast, refusal: GateRefusal<DriveRefusal>) =>
    Effect.sync(() => {
      for (const viewer of cast.viewers.values()) {
        viewer.ending = refusal;
        wake(viewer);
      }
    });

  const settle = (page: PageId) => (failure: CommandFailure) => ended(page, failure);

  const quiet =
    (page: PageId, what: string) =>
    <A>(effect: Effect.Effect<A, CommandFailure | GateRefusal<'action-failed'>>): Effect.Effect<A | void> =>
      effect.pipe(
        Effect.catchTags({
          SessionEnded: () => Effect.void,
          CommandRefused: (refused) => Effect.logWarning(`browser: page ${page} refused ${what}: ${refused.message}`),
          PayloadUnreadable: (unreadable) => Effect.logWarning(`browser: ${what} of page ${page} was unreadable: ${unreadable.message}`),
          WorkerUnavailable: (gone) => Effect.logWarning(`browser: ${what} of page ${page} was not read: ${gone.message}`),
          GateRefusal: (refused) => Effect.logWarning(`browser: ${what} of page ${page} was not applied: ${refused.reason}`),
        }),
      );

  const layout = (cast: Cast) =>
    cast.state.queue.withPermits(1)(
      Effect.gen(function* () {
        const wanted = layoutOf(casts.get(cast.page));
        if (sameLayout(wanted, cast.state.layout)) return;
        const before = effectiveOf(cast.state.emulation, cast.state.layout);
        cast.state.layout = wanted;
        const attached = cast.state.attached;
        if (attached !== null) yield* applyEmulation(attached, effectiveOf(cast.state.emulation, wanted), before);
      }).pipe(quiet(cast.page, 'the size of its viewer')),
    );

  const tune = (cast: Cast): Effect.Effect<void> =>
    Effect.andThen(restart(cast).pipe(quiet(cast.page, 'the budget of its viewers')), Effect.forkIn(layout(cast), scope));

  const screenshot = Effect.fnUntraced(
    function* (cast: Cast, attached: Attached, params: Params): Effect.fn.Return<void, CommandFailure> {
      const { cssVisualViewport: view } = yield* attached.session.send('Page.getLayoutMetrics');
      const scale = Math.min(1, params.maxWidth / view.clientWidth, params.maxHeight / view.clientHeight);
      const text = yield* attached.pictures.capture({
        format: 'jpeg',
        quality: params.quality,
        clip: { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale },
      });
      const sliced = sliceData(text);
      if (sliced === undefined) return yield* Effect.logWarning(`browser: the screenshot of page ${cast.page} carried no picture`);
      if (cast.params !== params) return;
      const now = yield* Clock.currentTimeMillis;
      const held: Held = {
        event: { type: 'frame', data: sliced.data, width: view.clientWidth, height: view.clientHeight },
        ack: null,
        at: now,
      };
      if (deliver(cast, held, now)) yield* Effect.forkIn(settled(cast), scope);
    },
    (effect, cast) => cast.state.queue.withPermits(1)(effect),
  );

  const restart = Effect.fnUntraced(function* (cast: Cast): Effect.fn.Return<void, CommandFailure> {
    const attached = cast.attached;
    const held = cast.held;
    if (attached === null || held === null || cast.viewers.size === 0) return;
    const params = paramsOf(cast.viewers.values());
    if (sameParams(cast.params, params)) return;
    cast.params = params;
    cast.pending = null;
    const mark = cast.arrived;
    yield* attached.session.send('Page.startScreencast', params).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (cast.params === params) cast.params = null;
        }),
      ),
    );
    yield* Effect.sleep(FIRST_FRAME).pipe(
      Effect.andThen(
        Effect.suspend(() => (cast.arrived === mark && cast.params === params ? screenshot(cast, attached, params) : Effect.void)),
      ),
      quiet(cast.page, 'the first picture'),
      Effect.forkIn(held),
    );
  });

  const onEvent = Effect.fnUntraced(function* (cast: Cast, event: CdpEvent) {
    if (event.method === 'Page.screencastFrame' && event.child === undefined) {
      const frame = castFrame(event.text);
      if (frame === undefined) return yield* Effect.logWarning(`browser: a frame of page ${cast.page} was unreadable`);
      cast.arrived += 1;
      const superseded = cast.pending;
      cast.pending = frame.ack;
      if (superseded !== null && cast.attached !== null)
        yield* cast.attached.session.post('Page.screencastFrameAck', { sessionId: superseded });
      const now = yield* Clock.currentTimeMillis;
      const held: Held = {
        event: { type: 'frame', data: frame.data, width: frame.width, height: frame.height },
        ack: frame.ack,
        at: frame.shownAt ?? now,
      };
      if (deliver(cast, held, now)) yield* Effect.forkIn(settled(cast), scope);
      return;
    }
    if (event.method !== 'Page.fileChooserOpened') return;
    const opened = yield* eventParams('Page.fileChooserOpened', event);
    if (opened.backendNodeId === undefined) return yield* Effect.logInfo(`browser: page ${cast.page} asked for a file without a field`);
    const multiple = opened.mode === 'selectMultiple';
    cast.chooser = { node: opened.backendNodeId, child: event.child, multiple };
    notice(cast, { type: 'chooser', multiple });
  });

  const run = Effect.fnUntraced(function* (cast: Cast, attached: Attached) {
    const host = yield* pages.hold(cast.page);
    cast.native = host.native;
    yield* host.pages.paint(cast.page).pipe(
      Effect.catchTags({
        PageMissing: () => Effect.fail(unknownPage(cast.page)),
        HostLost: (lost) => Effect.fail(hostRefusal(lost)),
        HostRefused: (refused) => Effect.fail(hostRefusal(refused)),
      }),
    );
    const events = yield* attached.session.events((method) => method === 'Page.screencastFrame' || method === 'Page.fileChooserOpened');
    yield* Stream.runForEach(events, (event) =>
      onEvent(cast, event).pipe(
        Effect.catchTags({
          PayloadUnreadable: (unreadable) =>
            Effect.logWarning(`browser: an event of page ${cast.page} was unreadable: ${unreadable.message}`),
          WorkerUnavailable: (gone) => Effect.logWarning(`browser: an event of page ${cast.page} was not read: ${gone.message}`),
        }),
      ),
    ).pipe(Effect.forkScoped);
    yield* cast.lock
      .withPermits(1)(
        Effect.gen(function* () {
          cast.attached = attached;
          cast.held = yield* Effect.scope;
          cast.params = null;
          yield* attached.session
            .send('Page.setInterceptFileChooserDialog', { enabled: true })
            .pipe(
              Effect.catchTag('CommandRefused', (refused) =>
                Effect.logInfo(`browser: page ${cast.page} keeps its own file choice: ${refused.message}`),
              ),
            );
          yield* restart(cast);
        }),
      )
      .pipe(
        Effect.catchIf((failure): failure is Exclude<CommandFailure, SessionEnded> => failure._tag !== 'SessionEnded', settle(cast.page)),
      );
    yield* Effect.forkIn(layout(cast), scope);
    yield* attached.session.ended;
  }, Effect.scoped);

  const keep = Effect.fnUntraced(function* (cast: Cast) {
    while (cast.viewers.size > 0) {
      const attached = yield* drive.attach(cast.state, null);
      yield* run(cast, attached).pipe(Effect.catchTag('SessionEnded', () => Effect.void));
      cast.attached = null;
      cast.held = null;
      cast.params = null;
      cast.pending = null;
      cast.chooser = null;
      if (cast.state.attached === attached) yield* drive.detach(cast.state);
    }
  });

  const start = Effect.fnUntraced(function* (cast: Cast): Effect.fn.Return<void> {
    cast.state.watching += 1;
    const life = yield* Scope.fork(scope);
    cast.life = life;
    const failed = (failure: Refusal) =>
      Effect.andThen(
        close(
          cast,
          failure instanceof GateRefusal
            ? failure
            : new GateRefusal<DriveRefusal>('host-away', `the page could not be watched: ${failure.message}`, ['watch the page again']),
        ),
        Effect.forkIn(cast.lock.withPermits(1)(Effect.suspend(() => (cast.life === life ? recover(cast) : Effect.void))), scope),
      );
    yield* keep(cast).pipe(Effect.catch(failed), Effect.forkIn(life));
  });

  const recover = Effect.fnUntraced(function* (cast: Cast): Effect.fn.Return<void> {
    yield* stop(cast);
    if ([...cast.viewers.values()].some((viewer) => viewer.ending === null)) yield* start(cast);
  });

  const stop = Effect.fnUntraced(function* (cast: Cast): Effect.fn.Return<void> {
    const life = cast.life;
    const attached = cast.attached;
    cast.life = null;
    if (attached !== null) {
      yield* attached.session.post('Page.stopScreencast');
      yield* attached.session.post('Page.setInterceptFileChooserDialog', { enabled: false });
    }
    if (life !== null) yield* Scope.close(life, Exit.void);
    cast.attached = null;
    cast.held = null;
    cast.params = null;
    cast.last = null;
    cast.pending = null;
    cast.chooser = null;
    cast.state.watching -= 1;
    if (cast.viewers.size === 0 && casts.get(cast.page) === cast) casts.delete(cast.page);
    yield* Effect.forkIn(layout(cast), scope);
  });

  const join = Effect.fnUntraced(function* (page: PageId, budget: Budget, keep: boolean) {
    const state = yield* drive.paged(page);
    const lock = yield* Semaphore.make(1);
    const cast: Cast = casts.get(page) ?? {
      page,
      state,
      viewers: new Map(),
      lock,
      life: null,
      held: null,
      attached: null,
      native: false,
      params: null,
      last: null,
      pending: null,
      arrived: 0,
      chooser: null,
      tuning: false,
    };
    casts.set(page, cast);
    named += 1;
    const viewer: Viewer = {
      id: `v${named}`,
      keep,
      budget,
      notices: [],
      frame: cast.last,
      wake: null,
      ending: null,
      stalled: null,
      received: 0,
      next: 0,
      turns: new Map(),
      buttons: 0,
    };
    cast.viewers.set(viewer.id, viewer);
    if (cast.chooser !== null && !keep) viewer.notices.push({ type: 'chooser', multiple: cast.chooser.multiple });
    yield* cast.lock.withPermits(1)(Effect.suspend(() => (cast.life === null ? start(cast) : tune(cast))));
    return { cast, viewer };
  });

  const leave = Effect.fnUntraced(function* (cast: Cast, viewer: Viewer) {
    cast.viewers.delete(viewer.id);
    for (const turn of viewer.turns.values()) yield* Deferred.fail(turn, viewerUnknown(viewer.id));
    viewer.turns.clear();
    yield* settled(cast);
  });

  const next = (
    cast: Cast,
    viewer: Viewer,
    until?: Deferred.Deferred<void>,
  ): Effect.Effect<ScreencastEvent | Held, Cause.Done | GateRefusal<DriveRefusal>> =>
    Effect.suspend(() => {
      const told = viewer.notices.shift();
      if (told !== undefined) return Effect.succeed(told);
      const held = viewer.frame;
      if (held !== null) {
        viewer.frame = null;
        viewer.received += 1;
        viewer.stalled = null;
        if (held.ack === null || held.ack !== cast.pending || cast.attached === null) return Effect.succeed(held);
        cast.pending = null;
        return Effect.as(cast.attached.session.post('Page.screencastFrameAck', { sessionId: held.ack }), held);
      }
      if (viewer.ending === 'evicted') return Cause.done();
      if (viewer.ending !== null) return Effect.fail(viewer.ending);
      if (until !== undefined && Deferred.isDoneUnsafe(until)) return Cause.done();
      const waiting = Deferred.makeUnsafe<void>();
      viewer.wake = waiting;
      const woken = until === undefined ? Deferred.await(waiting) : Effect.raceFirst(Deferred.await(waiting), Deferred.await(until));
      return Effect.andThen(woken, next(cast, viewer, until));
    });

  const pull = (cast: Cast, viewer: Viewer) => Effect.map(next(cast, viewer), (got) => ('ack' in got ? got.event : got));

  const shot = (cast: Cast, viewer: Viewer, until: Deferred.Deferred<void>): Effect.Effect<Shot, Cause.Done | GateRefusal<DriveRefusal>> =>
    Effect.flatMap(next(cast, viewer, until), (got) =>
      'ack' in got ? Effect.succeed({ data: got.event.data, at: got.at }) : shot(cast, viewer, until),
    );

  const viewing = <A>(
    page: PageId,
    budget: Budget,
    keep: boolean,
    read: (cast: Cast, viewer: Viewer) => Stream.Stream<A, GateRefusal<DriveRefusal>>,
  ) =>
    Stream.unwrap(
      Effect.map(
        Effect.acquireRelease(join(page, budget, keep), ({ cast, viewer }) => leave(cast, viewer)),
        ({ cast, viewer }) => read(cast, viewer),
      ),
    );

  const selection = Effect.fnUntraced(function* (attached: Attached) {
    const context = yield* world(attached, attached.main).pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null)));
    if (context === null) return '';
    const { result } = yield* attached.session.send('Runtime.evaluate', { expression: SELECTION, contextId: context, returnByValue: true });
    return typeof result.value === 'string' ? result.value : '';
  });

  const apply = Effect.fnUntraced(function* (cast: Cast, viewer: Viewer, events: readonly InputEvent[]) {
    const attached = cast.attached;
    if (attached === null) return { copied: null };
    const { session } = attached;
    const frame = cast.last?.event;
    let copied: string | null = null;
    let operated = false;
    const copying = events.some((event) => event.kind === 'copy');
    const dispatch = <M extends Method>(method: M, ...args: SendArgs<M>) =>
      copying
        ? session.send(method, ...args).pipe(Effect.asVoid, Effect.catchIf(isCommandFailure, settle(cast.page)))
        : session.post(method, ...args);
    for (const event of events) {
      if (!operated && operates(event, viewer.buttons)) {
        operated = true;
        yield* pages.operate(cast.page);
      }
      switch (event.kind) {
        case 'mouse': {
          if (frame === undefined) break;
          const at = { x: event.x * frame.width, y: event.y * frame.height, modifiers: event.modifiers };
          const bit = BUTTON_BITS[event.button];
          if (event.type === 'move') {
            yield* dispatch('Input.dispatchMouseEvent', {
              ...at,
              type: 'mouseMoved',
              button: pressed(viewer.buttons),
              buttons: viewer.buttons,
            });
            break;
          }
          viewer.buttons = event.type === 'down' ? viewer.buttons | bit : viewer.buttons & ~bit;
          yield* dispatch('Input.dispatchMouseEvent', {
            ...at,
            type: event.type === 'down' ? 'mousePressed' : 'mouseReleased',
            button: event.button,
            buttons: viewer.buttons,
            clickCount: Math.max(1, event.clicks),
          });
          break;
        }
        case 'wheel':
          if (frame === undefined) break;
          yield* dispatch('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: event.x * frame.width,
            y: event.y * frame.height,
            deltaX: event.dx,
            deltaY: event.dy,
            modifiers: event.modifiers,
          });
          break;
        case 'key': {
          const known = keyOf(event.code) ?? keyOf(event.key);
          const plain = (event.modifiers & (MODIFIERS.Alt | MODIFIERS.Control | MODIFIERS.Meta)) === 0;
          const text = event.type === 'down' && plain ? (event.key.length === 1 ? event.key : known?.text) : undefined;
          const editing = event.type === 'down' && (event.modifiers & ~MODIFIERS.Shift) === MODIFIERS.Meta;
          const commands =
            editing && event.code === 'KeyZ' && (event.modifiers & MODIFIERS.Shift) !== 0
              ? ['redo']
              : editing
                ? EDITING[event.code]
                : undefined;
          yield* dispatch('Input.dispatchKeyEvent', {
            type: event.type === 'up' ? 'keyUp' : text !== undefined ? 'keyDown' : 'rawKeyDown',
            key: event.key,
            code: event.code,
            windowsVirtualKeyCode: known?.keyCode,
            location: known?.location,
            modifiers: event.modifiers,
            text,
            unmodifiedText: text,
            commands: commands === undefined ? undefined : [...commands],
          });
          break;
        }
        case 'text': {
          const glyphs = Array.from(event.text);
          for (let at = 0; at < glyphs.length; at += TEXT_CHUNK) {
            yield* dispatch('Input.insertText', { text: glyphs.slice(at, at + TEXT_CHUNK).join('') });
          }
          break;
        }
        case 'copy':
          copied = yield* selection(attached).pipe(Effect.catchIf(isCommandFailure, settle(cast.page)));
          break;
        case 'view':
          viewer.budget = { ...viewer.budget, width: event.width, height: event.height, scale: event.scale };
          if (cast.tuning) break;
          cast.tuning = true;
          yield* Effect.forkIn(settled(cast), scope);
          break;
      }
    }
    return { copied };
  });

  const screencast = Screencast.of({
    watch: (page, budget) =>
      viewing(page, budget, false, (cast, viewer) => {
        const named: ScreencastEvent = { type: 'viewer', viewer: viewer.id };
        return Stream.concat(Stream.succeed(named), Stream.fromEffectRepeat(pull(cast, viewer)));
      }),
    input: Effect.fn('Screencast.input')(function* (page, id, seq, events) {
      const cast = casts.get(page);
      const viewer = cast?.viewers.get(id);
      if (cast === undefined || viewer === undefined) return yield* viewerUnknown(id);
      if (seq < viewer.next || viewer.turns.has(seq)) return { copied: null };
      if (seq > viewer.next) {
        const turn = yield* Deferred.make<void, GateRefusal<'viewer-unknown'>>();
        viewer.turns.set(seq, turn);
        yield* Deferred.await(turn);
      }
      return yield* apply(cast, viewer, events).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            viewer.next = seq + 1;
            const after = viewer.turns.get(viewer.next);
            viewer.turns.delete(viewer.next);
            return after === undefined ? Effect.void : Deferred.succeed(after, undefined);
          }),
        ),
      );
    }),
    choose: Effect.fn('Screencast.choose')(function* (page, chosen) {
      const cast = casts.get(page);
      const chooser = cast?.chooser ?? null;
      const attached = cast?.attached ?? null;
      if (cast === undefined || chooser === null || attached === null) return yield* noChooser(page);
      cast.chooser = null;
      notice(cast, { type: 'chosen' });
      const taken: readonly Chosen[] = chooser.multiple ? chosen : chosen.slice(0, 1);
      if (taken.length === 0) return 0;
      const dir = path.join(chosenOf(path, place, page), String(yield* Clock.currentTimeMillis));
      const paths: string[] = [];
      for (const [index, file] of taken.entries()) {
        const base = path.basename(file.name);
        const into = path.join(dir, String(index));
        yield* Effect.orDie(files.makeDirectory(into, { recursive: true }));
        const named = path.join(into, base === '' || base === '.' || base === '..' ? 'file' : base);
        yield* Effect.orDie(files.writeFile(named, file.bytes));
        paths.push(named);
      }
      yield* attached.session
        .send('DOM.setFileInputFiles', { files: paths, backendNodeId: chooser.node }, chooser.child)
        .pipe(Effect.catchIf(isCommandFailure, settle(page)));
      return taken.length;
    }),
  });

  return {
    screencast,
    shots: (page: PageId, budget: Budget, until: Deferred.Deferred<void>): Stream.Stream<Shot, GateRefusal<DriveRefusal>> =>
      viewing(page, budget, true, (cast, viewer) => Stream.fromEffectRepeat(shot(cast, viewer, until))),
  };
});

export type Shots = Effect.Success<ReturnType<typeof makeScreencast>>['shots'];
