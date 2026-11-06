import { totalmem } from 'node:os';
import type { HostEvent, Strain } from '@tagma/server/browser/contract/wire/host';
import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Disposition } from '@tagma/server/browser/contract/wire/page';
import type { Call, Failure } from '@tagma/server/desktop-browser/contract/wire/channel';
import {
  app,
  BaseWindow,
  type BrowserWindow,
  type Event,
  type FrameCreatedDetails,
  type Input,
  type InputEvent,
  type WebContents,
  WebContentsView,
  type WebFrameMain,
} from 'electron';
import { BROWSER } from '../channels.js';
import { devToolsChord, newWindowChord, toggleDevTools } from '../projectWindows.js';
import type { Executor, Reporter } from './connection.js';
import { Driven } from './driven.js';
import { HeapCaptures } from './heaps.js';
import { readKey } from './keychain.js';
import { showPageMenu } from './menu.js';
import { allowedUrl, HeldPage, type PageEvents, type Settled, viewPreferences } from './page.js';
import { Placement } from './placement.js';
import { showPopup } from './popups.js';
import type { Profiles } from './profiles.js';
import type { GateFailure, NavigationGate } from './restrictions.js';
import { RendererStrain } from './strain.js';

const GESTURE_MS = 1_000;
const TAB_BUDGET = 4;
const TAB_WINDOW_MS = 2_000;
const ACTIVATING = new Set(['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'char', 'touchStart', 'touchEnd', 'gestureTap']);
const OPERATED_EVERY_MS = 1_000;
const PROBE_EVERY_MS = 1_000;
const OPERATING = new Set([
  'mouseDown',
  'mouseUp',
  'mouseWheel',
  'rawKeyDown',
  'keyDown',
  'keyUp',
  'char',
  'touchStart',
  'touchMove',
  'touchEnd',
]);
const HELD_BUTTONS = new Set(['leftbuttondown', 'middlebuttondown', 'rightbuttondown']);
const FROM_DEBUGGER = 1 << 23;
type NativeInput = InputEvent & { readonly _modifiers?: number };

const operating = (input: NativeInput): boolean =>
  OPERATING.has(input.type) || (input.type === 'mouseMove' && (input.modifiers ?? []).some((held) => HELD_BUTTONS.has(held)));

export const liveLimit = (): number => Math.max(4, Math.floor(totalmem() / 2 ** 30));

export type HostActs = {
  readonly newWindow: (from: BrowserWindow) => void;
  readonly reveal: (popup: BaseWindow) => void;
  readonly pressed: (window: BrowserWindow, page: string, input: Input) => boolean;
};

type Service = { readonly view: WebContentsView; readonly window: BaseWindow };

type GateWatch = { readonly gate: NavigationGate; failure: GateFailure | null };

type Lease = { readonly page: HeldPage; readonly release: () => void };

export class BrowserHost implements Executor {
  readonly placement: Placement;
  private reporter: Reporter | null = null;
  private readonly pages = new Map<string, HeldPage>();
  private readonly byId = new Map<PageId, HeldPage>();
  private readonly byContents = new Map<WebContents, HeldPage>();
  private readonly popups = new Map<HeldPage, BaseWindow>();
  private readonly sessions = new Map<number, Driven>();
  private readonly holds = new Map<number, HeldPage>();
  private readonly watches = new Map<number, GateWatch>();
  private readonly leases = new Map<number, Lease>();
  private readonly strains = new RendererStrain((renderers) => {
    for (const page of this.pages.values()) {
      if (!page.contents.isDestroyed() && renderers.has(page.contents.getOSProcessId())) page.suspend();
    }
  });
  private readonly heaps = new HeapCaptures(this.strains);
  private probing: ReturnType<typeof setInterval> | null = null;
  private readonly services = new Map<string, Service>();
  private readonly reported = new WeakMap<HeldPage, number>();
  private readonly observers: (() => void)[] = [];
  private locals = 0;
  private revisions = 0;
  private readonly events: PageEvents;

  constructor(
    private readonly profiles: Profiles,
    private readonly identity: 'cleaned' | 'native',
    private readonly acts: HostActs,
    private readonly limit: number = liveLimit(),
  ) {
    this.placement = new Placement((window, panel, placed) => {
      const page = [...this.pages.values()].find((held) => held.placed === placed);
      if (page !== undefined && page.id !== null && !window.isDestroyed())
        window.webContents.send(BROWSER.elsewhere, { page: page.id, panel });
    });
    this.events = {
      revision: () => ++this.revisions,
      event: (_page, event) => this.reporter?.event(event),
      closed: (page) => this.closed(page),
      window: (page) => this.popups.get(page) ?? page.placed.shown?.window ?? null,
      navigation: (page, active) => this.profiles.navigation(page.contents, active ? (url) => page.restrictions.block(url) !== null : null),
      blocked: (watch, block) => {
        const watched = this.watches.get(watch);
        if (watched !== undefined) watched.failure = watched.gate.failure;
        this.reporter?.blocked(watch, block);
      },
    };
  }

  page(id: string): HeldPage | undefined {
    return this.byId.get(id as PageId);
  }

  pageOf(contents: WebContents): PageId | null {
    return this.byContents.get(contents)?.id ?? null;
  }

  observe(listener: () => void): void {
    this.observers.push(listener);
  }

  downloaded(contents: WebContents, download: Extract<HostEvent, { readonly kind: 'download' }>['download']): void {
    const page = this.byContents.get(contents);
    if (page?.id != null) this.reporter?.event({ kind: 'download', page: page.id, download });
  }

  window(contents: WebContents): BaseWindow | null {
    const page = this.byContents.get(contents);
    return page === undefined ? null : this.events.window(page);
  }

  attach(reporter: Reporter): void {
    this.reporter = reporter;
  }

  detach(): void {
    this.reporter = null;
    for (const watched of this.watches.values()) {
      watched.gate.watch = null;
      watched.gate.failure = null;
    }
    this.watches.clear();
    for (const driven of this.sessions.values()) driven.detach();
    this.sessions.clear();
    for (const [hold, page] of this.holds) this.placement.release(page.placed, hold);
    this.holds.clear();
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear();
  }

  cdp(session: number, text: string): void {
    this.sessions.get(session)?.command(text);
  }

  call(id: number, call: Call): void {
    const reporter = this.reporter;
    if (reporter === null) return;
    try {
      this.perform(reporter, id, call);
    } catch (error) {
      console.error(`[tagma-desktop] the browser call ${call.kind} failed`, error);
      reporter.fail(id, {
        kind: 'refused',
        message: `the desktop failed the ${call.kind} call: ${String(error)}`,
        unblock: ['make the call again'],
      });
    }
  }

  private perform(reporter: Reporter, id: number, call: Call): void {
    const answer = (value: unknown = null) => reporter.answer(id, value);
    const fail = (failure: Failure) => reporter.fail(id, failure);
    const settled = (outcome: Settled) => ('change' in outcome ? answer(outcome.change) : fail(outcome.failure));
    const missing = (page: string) => fail({ kind: 'missing', message: `the desktop holds no page ${page}` });
    switch (call.kind) {
      case 'open': {
        if (call.context !== null)
          return fail({
            kind: 'refused',
            message: 'the desktop opens pages only in the persistent context of a profile',
            unblock: ['open the page without a context'],
          });
        if (!allowedUrl(call.url))
          return fail({
            kind: 'refused',
            message: `${call.url} is not an http, https or blob address`,
            unblock: ['open an http or https address'],
          });
        const standing = this.byId.get(call.page);
        if (standing !== undefined) return answer(standing.restrictions.state);
        this.profiles.session(call.profile);
        const page = this.track(HeldPage.create(this.local(), call.page, call.profile, null, this.identity, this.strains, this.events));
        page.restrictions.admit(call.policy, null);
        const committed = page.committed();
        const block = page.load(call.url, call.history);
        if (block === null) {
          void committed.then(() => answer(page.restrictions.state));
          return;
        }
        void page
          .close(false)
          .then(() => fail({ kind: 'blocked', block, message: `navigation to ${block.domain} is blocked by ${block.setting}` }));
        return;
      }
      case 'adopt': {
        const page = this.pages.get(call.local);
        if (page === undefined || page.id !== null) return missing(call.local);
        page.id = call.page;
        this.byId.set(call.page, page);
        this.pagesMoved();
        answer(page.restrictions.state);
        return reporter.event({ kind: 'changed', page: call.page, change: page.state() });
      }
      case 'close': {
        const page = this.byId.get(call.page);
        if (page === undefined) return answer();
        if (call.ask && page.dialogOpen && !page.closingNow)
          return fail({
            kind: 'refused',
            message: `a dialog is open on page ${call.page}, and closing it would bypass the answer`,
            unblock: ['answer_page_dialog — accept or dismiss it first, then close_page'],
          });
        void page
          .close(call.ask)
          .then((closed) =>
            closed ? answer() : fail({ kind: 'stayed', message: 'the page asked to stay, and leaving it was dismissed' }),
          );
        return;
      }
      case 'live': {
        const live = [...this.pages.values()].filter((page) => !page.unloading && !page.contents.isDestroyed());
        answer(
          live.map((page) => ({
            page: page.id,
            local: page.local,
            profile: page.profile,
            url: page.contents.getURL() || 'about:blank',
            title: page.contents.getTitle(),
            opener: page.opener,
            restriction: page.restrictions.state,
          })),
        );
        for (const page of live) page.restate();
        return;
      }
      case 'navigate': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        void page.navigate(call.to).then(settled);
        return;
      }
      case 'navigation': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        const { gate, changes } = page.restrictions.admit(call.policy, call.watch);
        if (gate !== null) this.watches.set(call.watch, { gate, failure: gate.failure });
        return answer({ blocked: gate?.failure?.block ?? null, changes });
      }
      case 'navigationSeen': {
        const watched = this.watches.get(call.watch);
        if (watched?.failure != null) watched.failure.seen = true;
        return answer();
      }
      case 'unnavigation': {
        const watched = this.watches.get(call.watch);
        this.watches.delete(call.watch);
        if (watched !== undefined && watched.gate.watch === call.watch) {
          watched.gate.watch = null;
          watched.gate.failure = null;
        }
        return answer();
      }
      case 'pdf': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        page.contents.printToPDF({ printBackground: true }).then(
          (bytes) => reporter.bytes(id, bytes.toString('base64')),
          (error: unknown) =>
            fail({ kind: 'refused', message: `the page did not print: ${String(error)}`, unblock: ['make the call again'] }),
        );
        return;
      }
      case 'heap': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        return this.heaps.capture(page, call.path, reporter, id);
      }
      case 'answer': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        page.answer(call.accept, call.text);
        return answer();
      }
      case 'paint': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        this.holds.set(call.hold, page);
        let told = false;
        return this.placement.hold(
          page.placed,
          call.hold,
          () => {
            if (told) return;
            told = true;
            answer();
          },
          () => this.reporter !== reporter,
        );
      }
      case 'unpaint': {
        const page = this.holds.get(call.hold);
        this.holds.delete(call.hold);
        if (page !== undefined) this.placement.release(page.placed, call.hold);
        return answer();
      }
      case 'strain': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        this.leases.set(call.hold, { page, release: this.strain(page, call.strain) });
        return answer();
      }
      case 'geolocation': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        const release = this.profiles.geolocation(page.contents);
        if (release === null)
          return fail({
            kind: 'refused',
            message: 'this page has no origin to grant geolocation',
            unblock: ['navigate to an http or https page'],
          });
        this.leases.set(call.hold, { page, release });
        return answer();
      }
      case 'unstrain':
      case 'unlocate': {
        const lease = this.leases.get(call.hold);
        this.leases.delete(call.hold);
        lease?.release();
        return answer();
      }
      case 'session': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        page.driven?.detach();
        const driven = Driven.attach(page.contents, call.session, reporter, (gone, end) => {
          this.sessions.delete(gone.session);
          if (page.driven !== gone) return;
          page.driving(null);
          if (end !== 'closed') this.placement.settle(page.placed);
        });
        if (!(driven instanceof Driven)) return fail(driven);
        this.sessions.set(call.session, driven);
        page.driving(driven);
        return this.placement.wake(page.placed, answer, () => this.reporter !== reporter);
      }
      case 'profileSession': {
        const service = this.service(call.profile);
        const driven = Driven.attach(service.view.webContents, call.session, reporter, (gone) => this.sessions.delete(gone.session));
        if (!(driven instanceof Driven)) return fail(driven);
        this.sessions.set(call.session, driven);
        return answer();
      }
      case 'unsession':
        this.sessions.get(call.session)?.detach();
        return answer();
      case 'prepare':
        this.profiles.session(call.profile);
        return answer();
      case 'remove': {
        const service = this.services.get(call.profile);
        this.services.delete(call.profile);
        service?.view.webContents.close();
        service?.window.destroy();
        for (const page of [...this.pages.values()])
          if (page.profile === call.profile && !page.contents.isDestroyed()) page.contents.close();
        this.profiles.clear(call.profile).then(
          () => answer(),
          (error: unknown) =>
            fail({
              kind: 'refused',
              message: `the storage of profile ${call.profile} was not cleared: ${String(error)}`,
              unblock: ['make the call again'],
            }),
        );
        return;
      }
      case 'key':
        readKey(call.service, call.account).then(
          (read) => ('key' in read ? answer(read.key) : fail(read.failure)),
          (error: unknown) =>
            fail({
              kind: 'refused',
              message: `the Keychain key ${call.service} was not read: ${String(error)}`,
              unblock: ['import again'],
            }),
        );
        return;
    }
  }

  private strain(page: HeldPage, strain: Strain): () => void {
    const frame = page.contents.mainFrame;
    const releases: (() => void)[] = [];
    if (strain.factor > 1) {
      const contents = page.contents;
      const cpu = this.strains.cpu(page.profile, strain.factor);
      const refresh = (extra: WebFrameMain | null = null) => {
        if (contents.isDestroyed()) return;
        const root = contents.mainFrame;
        const frames = root.isDestroyed() ? [] : root.framesInSubtree;
        const renderers = frames
          .filter((child) => !child.isDestroyed())
          .map((child) => child.osProcessId)
          .filter((pid) => pid > 0);
        if (extra !== null && !extra.isDestroyed() && extra.osProcessId > 0) renderers.push(extra.osProcessId);
        cpu.update(renderers, page.navigationPending);
      };
      const changed = () => refresh();
      const created = (_event: Event, details: FrameCreatedDetails) => refresh(details.frame);
      contents.on('did-start-navigation', changed);
      contents.on('did-redirect-navigation', changed);
      contents.on('did-frame-navigate', changed);
      contents.on('did-fail-provisional-load', changed);
      contents.on('did-fail-load', changed);
      contents.on('did-stop-loading', changed);
      contents.on('render-process-gone', changed);
      contents.on('frame-created', created);
      changed();
      releases.push(() => {
        contents.off('did-start-navigation', changed);
        contents.off('did-redirect-navigation', changed);
        contents.off('did-frame-navigate', changed);
        contents.off('did-fail-provisional-load', changed);
        contents.off('did-fail-load', changed);
        contents.off('did-stop-loading', changed);
        contents.off('render-process-gone', changed);
        contents.off('frame-created', created);
        cpu.release();
      });
    }
    const renderer = frame.osProcessId;
    if (strain.paused && renderer > 0) releases.push(this.strains.hold([renderer], { factor: 1, paused: true }));
    return () => {
      for (const release of releases) release();
    };
  }

  private local(): string {
    this.locals += 1;
    return `page-${this.locals}`;
  }

  private service(profile: string): Service {
    const standing = this.services.get(profile);
    if (standing !== undefined && !standing.view.webContents.isDestroyed()) return standing;
    this.profiles.session(profile);
    const window = new BaseWindow({ show: false, width: 400, height: 300, focusable: false, skipTaskbar: true });
    const view = new WebContentsView({ webPreferences: viewPreferences(profile) });
    window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 400, height: 300 });
    void view.webContents.loadURL('about:blank').catch(() => undefined);
    const made = { view, window };
    this.services.set(profile, made);
    return made;
  }

  private track(page: HeldPage): HeldPage {
    this.pages.set(page.local, page);
    this.probing ??= setInterval(() => this.sampleRenderers(), PROBE_EVERY_MS);
    if (page.id !== null) this.byId.set(page.id, page);
    this.byContents.set(page.contents, page);
    this.placement.add(page.placed);
    this.police(page);
    this.trim(page);
    this.pagesMoved();
    return page;
  }

  private sampleRenderers(): void {
    const pages = [...this.pages.values()].filter((page) => page.needsCpu && !page.contents.isDestroyed());
    if (pages.length === 0) return;
    const metrics = new Map(app.getAppMetrics().map((metric) => [metric.pid, metric]));
    for (const page of pages) {
      const metric = metrics.get(page.contents.getOSProcessId());
      const cpu = metric?.cpu.cumulativeCPUUsage;
      page.sample(
        metric === undefined || cpu === undefined ? null : { process: `${metric.pid}/${metric.creationTime}`, millis: cpu * 1_000 },
      );
    }
  }

  private pagesMoved(): void {
    for (const listener of this.observers) listener();
  }

  private closed(page: HeldPage): void {
    this.profiles.navigation(page.contents, null);
    for (const [watch, watched] of this.watches) if (watched.gate.source === page.restrictions) this.watches.delete(watch);
    this.pages.delete(page.local);
    if (this.pages.size === 0 && this.probing !== null) {
      clearInterval(this.probing);
      this.probing = null;
    }
    if (page.id !== null && this.byId.get(page.id) === page) this.byId.delete(page.id);
    this.byContents.delete(page.contents);
    this.popups.delete(page);
    this.placement.remove(page.placed);
    for (const [hold, held] of this.holds) if (held === page) this.holds.delete(hold);
    for (const [hold, lease] of this.leases) {
      if (lease.page !== page) continue;
      this.leases.delete(hold);
      lease.release();
    }
    if (!page.unloading && page.id !== null) this.reporter?.event({ kind: 'closed', page: page.id });
    this.pagesMoved();
  }

  private opened(page: HeldPage, opener: HeldPage, url: string, disposition: Disposition): void {
    this.reporter?.event({
      kind: 'opened',
      local: page.local,
      profile: page.profile,
      opener: opener.id,
      url,
      restriction: page.restrictions.state,
      disposition,
    });
  }

  private openTab(opener: HeldPage, url: string, disposition: Disposition, human = false): void {
    if (!human && opener.restrictions.block(url) !== null) return;
    const page = HeldPage.create(this.local(), null, opener.profile, opener.id, this.identity, this.strains, this.events);
    page.restrictions.inherit(opener.restrictions);
    if (human) this.operated(page);
    this.track(page);
    page.load(url, null);
    this.opened(page, opener, url, disposition);
  }

  private police(page: HeldPage): void {
    const contents = page.contents;
    let gesture: number | null = null;
    const opens: number[] = [];
    contents.on('input-event', (_event, input) => {
      if (ACTIVATING.has(input.type)) gesture = Date.now();
      const native: NativeInput = input;
      const injected =
        native._modifiers === undefined ? page.driven?.injects(input.type) === true : (native._modifiers & FROM_DEBUGGER) !== 0;
      if (operating(input) && !injected) this.operated(page);
    });
    const clicked = () => {
      const at = gesture;
      gesture = null;
      return at !== null && Date.now() - at <= GESTURE_MS;
    };
    const budget = () => {
      const now = Date.now();
      while (opens.length > 0 && now - opens[0]! > TAB_WINDOW_MS) opens.shift();
      if (opens.length >= TAB_BUDGET) return false;
      opens.push(now);
      return true;
    };
    contents.setWindowOpenHandler(({ url, frameName, disposition, referrer, postBody }) => {
      const click = clicked();
      if (!allowedUrl(url) || page.restrictions.block(url) !== null || !(click || budget())) return { action: 'deny' };
      if (frameName === '' && (disposition === 'foreground-tab' || disposition === 'background-tab')) {
        this.openTab(page, url, disposition === 'foreground-tab' ? 'tab' : 'background-tab');
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const adopted = (options as { readonly webContents?: WebContents }).webContents;
          const popup = HeldPage.create(this.local(), null, page.profile, page.id, this.identity, this.strains, this.events, adopted);
          popup.restrictions.inherit(page.restrictions);
          this.popups.set(
            popup,
            showPopup(popup, { width: options.width, height: options.height }, () => this.placement.settle(popup.placed), this.acts.reveal),
          );
          this.track(popup);
          if (adopted === undefined) {
            const posted =
              postBody === undefined
                ? {}
                : { postData: postBody.data, extraHeaders: `content-type: ${postBody.contentType}; boundary=${postBody.boundary}` };
            popup.contents.loadURL(url, { httpReferrer: referrer, ...posted }).catch(() => undefined);
          }
          this.opened(popup, page, url, 'window');
          return popup.contents;
        },
      };
    });
    contents.on('before-input-event', (event, input) => this.key(page, event, input));
    contents.on('context-menu', (_event, params) => {
      const window = this.events.window(page);
      if (window !== null) showPageMenu(window, contents, params, { openTab: (url) => this.openTab(page, url, 'background-tab', true) });
    });
    contents.on('found-in-page', (_event, result) => {
      const window = page.placed.shown?.window;
      if (page.id !== null && window !== undefined && !window.isDestroyed()) {
        window.webContents.send(BROWSER.found, { page: page.id, matches: result.matches, active: result.activeMatchOrdinal });
      }
    });
  }

  private operated(page: HeldPage): void {
    const changes = this.profiles.restricted(page.profile) ? page.restrictions.operated() : [];
    if (page.id === null) {
      if (changes.length > 0) this.reporter?.event({ kind: 'restrictions', changes });
      return;
    }
    const now = Date.now();
    if (changes.length === 0 && now - (this.reported.get(page) ?? 0) < OPERATED_EVERY_MS) return;
    this.reported.set(page, now);
    this.reporter?.event({ kind: 'operated', page: page.id, changes });
  }

  private key(page: HeldPage, event: Event, input: Input): void {
    const window = page.placed.shown?.window;
    if (window === undefined || window.isDestroyed() || input.type !== 'keyDown') return;
    const mac = process.platform === 'darwin';
    if (newWindowChord(input, mac)) {
      event.preventDefault();
      this.acts.newWindow(window);
      return;
    }
    if (devToolsChord(input, mac)) {
      event.preventDefault();
      toggleDevTools(window);
      return;
    }
    if (page.id !== null && this.acts.pressed(window, page.id, input)) event.preventDefault();
  }

  private trim(arrived: HeldPage): void {
    const reporter = this.reporter;
    if (reporter === null) return;
    const live = [...this.pages.values()].filter((page) => !page.unloading && !page.contents.isDestroyed());
    if (live.length <= this.limit) return;
    const idle = live
      .filter(
        (page) =>
          page !== arrived &&
          page.id !== null &&
          page.placed.shown === null &&
          page.driven === null &&
          page.placed.holds.size === 0 &&
          !page.dialogOpen &&
          !this.popups.has(page),
      )
      .sort((one, other) => one.placed.shownAt - other.placed.shownAt);
    for (const page of idle.slice(0, live.length - this.limit)) {
      page.unloading = true;
      reporter.event({ kind: 'changed', page: page.id!, change: { history: page.state().history! } });
      reporter.event({ kind: 'dropped', page: page.id! });
      page.contents.close();
    }
  }
}
