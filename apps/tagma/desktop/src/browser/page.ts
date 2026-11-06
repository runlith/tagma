import { Probe, type RendererCpu } from '@runlith/cdp/probe';
import type { HostEvent, Navigation, PageChange, Strain } from '@tagma/server/browser/contract/wire/host';
import type { DomainBlock } from '@tagma/server/browser/contract/wire/domains';
import type { PageId, ProfileId } from '@tagma/server/browser/contract/wire/ids';
import type { Dialog, History } from '@tagma/server/browser/contract/wire/page';
import type { Failure } from '@tagma/server/desktop-browser/contract/wire/channel';
import {
  type BaseWindow,
  dialog,
  type Event,
  type WebContents,
  type WebContentsDidStartNavigationEventParams,
  WebContentsView,
  type WebFrameMain,
  webContents,
  webFrameMain,
} from 'electron';
import { type Driven, probeFrame } from './driven.js';
import { firefoxAgent, isGoogleSignIn } from './identity.js';
import { type Placed, VIEWPORT } from './placement.js';
import { partitionOf } from './profiles.js';
import { Restrictions } from './restrictions.js';
import type { RendererStrain } from './strain.js';

const ABORTED = -3;

export const allowedUrl = (url: string): boolean => {
  if (url === 'about:blank') return true;
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'blob:' || !URL.canParse(parsed.pathname)) return false;
  return ['http:', 'https:'].includes(new URL(parsed.pathname).protocol);
};

export type Settled = { readonly change: PageChange } | { readonly failure: Failure };

type Held = {
  readonly dialog: Dialog;
  readonly callback: (accept: boolean, text: string) => void;
  box: AbortController | null;
  told: boolean;
};

type Going = { readonly to: Navigation; readonly settle: (settled: Settled) => void; readonly unhook: () => void };

type Leaving = { readonly retry: (() => void) | null; readonly stay: (() => void) | null };

type Closing = { readonly stay: () => void; readonly done: Promise<boolean> };

type NativeProbe = { phase: 'starting' | 'waiting' | 'unresponsive' };

type RootProcess = { readonly pid: number; readonly host: number };

const STAYED = 'the page asked to stay, and leaving it was dismissed';

type RunDialog = {
  readonly frame: WebFrameMain | null;
  readonly dialogType: 'alert' | 'confirm' | 'prompt';
  readonly messageText: string;
};

export type PageEvents = {
  readonly revision: () => number;
  readonly event: (page: HeldPage, event: HostEvent) => void;
  readonly closed: (page: HeldPage) => void;
  readonly window: (page: HeldPage) => BaseWindow | null;
  readonly navigation: (page: HeldPage, active: boolean) => void;
  readonly blocked: (watch: number, block: DomainBlock) => void;
};

const touches = (contents: WebContents, renderer: number, origins: ReadonlySet<string>): boolean =>
  contents.mainFrame.framesInSubtree.some((frame) => !frame.isDestroyed() && (frame.osProcessId === renderer || origins.has(frame.origin)));

export const viewPreferences = (profile: string) =>
  ({ partition: partitionOf(profile), sandbox: true, contextIsolation: true, nodeIntegration: false }) as const;

export class HeldPage {
  id: PageId | null;
  driven: Driven | null = null;
  unloading = false;
  readonly contents: WebContents;
  readonly placed: Placed;
  readonly restrictions: Restrictions;
  private held: Held | null = null;
  private going: Going | null = null;
  private readonly pending = new Map<number | symbol, string>();
  private leaving: Leaving | null = null;
  private closing: Closing | null = null;
  private ending: Promise<boolean> | null = null;
  private allowLeave = false;
  private unresponsiveProcess: RootProcess | null = null;
  private restarting = false;
  private probe: NativeProbe | null = null;
  private readonly budget = new Probe(5_000);
  private readonly firefox: string | null;

  constructor(
    readonly local: string,
    id: PageId | null,
    readonly profile: ProfileId,
    readonly opener: PageId | null,
    readonly view: WebContentsView,
    identity: 'cleaned' | 'native',
    private readonly strains: RendererStrain,
    private readonly events: PageEvents,
  ) {
    this.id = id;
    this.restrictions = new Restrictions({
      id: () => this.id,
      revision: events.revision,
      navigation: (active) => events.navigation(this, active),
      blocked: events.blocked,
      refused: (block) => this.emit((page) => ({ kind: 'navigation-blocked', page, block })),
    });
    this.firefox = identity === 'cleaned' ? firefoxAgent() : null;
    this.contents = view.webContents;
    this.placed = {
      view,
      contents: this.contents,
      home: null,
      parking: null,
      shown: null,
      size: { ...VIEWPORT },
      holds: new Set(),
      shownAt: Date.now(),
      driven: false,
      awake: null,
    };
    this.follow();
  }

  static create(
    local: string,
    id: PageId | null,
    profile: ProfileId,
    opener: PageId | null,
    identity: 'cleaned' | 'native',
    strains: RendererStrain,
    events: PageEvents,
    contents?: WebContents,
  ): HeldPage {
    const view = new WebContentsView(
      contents === undefined
        ? { webPreferences: viewPreferences(profile) }
        : { webPreferences: viewPreferences(profile), webContents: contents },
    );
    return new HeldPage(local, id, profile, opener, view, identity, strains, events);
  }

  get closingNow(): boolean {
    return this.closing !== null;
  }

  get dialogOpen(): boolean {
    return this.held !== null || this.leaving !== null;
  }

  get navigationPending(): boolean {
    return this.pending.size > 0;
  }

  state(): PageChange {
    return { ...this.located(), loading: this.contents.isLoading() };
  }

  private located(): PageChange {
    const contents = this.contents;
    const history = contents.navigationHistory;
    return {
      url: contents.getURL() || 'about:blank',
      title: contents.getTitle(),
      back: history.canGoBack(),
      forward: history.canGoForward(),
      history: { entries: history.getAllEntries().map((entry) => ({ url: entry.url, title: entry.title })), at: history.getActiveIndex() },
    };
  }

  committed(): Promise<void> {
    const contents = this.contents;
    return new Promise((settle) => {
      const done = () => {
        contents.off('did-navigate', done);
        contents.off('did-fail-provisional-load', failed);
        contents.off('did-fail-load', failed);
        contents.off('did-stop-loading', done);
        contents.off('destroyed', done);
        settle();
      };
      const failed = (_event: Event, _code: number, _description: string, _url: string, main: boolean) => {
        if (main) done();
      };
      contents.on('did-navigate', done);
      contents.on('did-fail-provisional-load', failed);
      contents.on('did-fail-load', failed);
      contents.on('did-stop-loading', done);
      contents.once('destroyed', done);
    });
  }

  load(url: string, history: History | null): DomainBlock | null {
    const target = history !== null && history.entries.length > 0 ? (history.entries[history.at]?.url ?? url) : url;
    const block = this.restrictions.block(target);
    if (block !== null) {
      this.load('about:blank', null);
      return block;
    }
    const restoring = history !== null && history.entries.length > 0;
    this.agentFor(restoring ? (history.entries[history.at]?.url ?? url) : url);
    if (restoring) {
      this.contents.navigationHistory
        .restore({ entries: history.entries.map((entry) => ({ url: entry.url, title: entry.title })), index: history.at })
        .catch((error: unknown) => console.info(`[tagma-desktop] page ${this.local} restored with: ${String(error)}`));
      return null;
    }
    this.contents.loadURL(url).catch((error: unknown) => console.info(`[tagma-desktop] page ${this.local} opened with: ${String(error)}`));
    return null;
  }

  navigate(to: Navigation): Promise<Settled> {
    if (to.kind === 'stop') {
      this.contents.stop();
      return Promise.resolve({ change: { ...this.state(), loading: false } });
    }
    if (to.kind === 'url' && !allowedUrl(to.url)) {
      return Promise.resolve({
        failure: { kind: 'navigation', code: 'net::ERR_DISALLOWED_URL_SCHEME', message: `${to.url} is not an http, https or blob address` },
      });
    }
    const history = this.contents.navigationHistory;
    const offset = to.kind === 'back' ? -1 : to.kind === 'forward' ? 1 : 0;
    const target = to.kind === 'url' ? to.url : history.getEntryAtIndex(history.getActiveIndex() + offset)?.url;
    const block = target === undefined ? null : this.restrictions.block(target);
    if (block !== null) {
      return Promise.resolve({
        failure: { kind: 'blocked', block, message: `navigation to ${block.domain} is blocked by ${block.setting}` },
      });
    }
    if ((to.kind === 'back' && !history.canGoBack()) || (to.kind === 'forward' && !history.canGoForward())) {
      return Promise.resolve({ change: this.state() });
    }
    return new Promise((settle) => this.go(to, settle));
  }

  answer(accept: boolean, text: string | null): void {
    const held = this.held;
    if (held !== null) {
      this.held = null;
      held.box?.abort();
      held.callback(accept, text ?? '');
      if (held.told) this.tell(null);
      return;
    }
    const leaving = this.leaving;
    if (leaving === null) return;
    this.leaving = null;
    this.tell(null);
    if (!accept) {
      leaving.stay?.();
      return;
    }
    const retry = leaving.retry;
    if (retry === null) {
      this.allowLeave = true;
      return;
    }
    const leave = () => {
      this.allowLeave = true;
      retry();
    };
    probeFrame(this.contents).then(leave, leave);
  }

  close(ask: boolean): Promise<boolean> {
    const contents = this.contents;
    if (contents.isDestroyed()) return Promise.resolve(true);
    if (!ask || !this.responsive) {
      if (this.ending !== null) return this.ending;
      const done = this.closing?.done ?? new Promise<boolean>((settle) => contents.once('destroyed', () => settle(true)));
      if (this.hungAlone()) {
        this.ending = done;
        contents.once('render-process-gone', () => contents.close());
        contents.forcefullyCrashRenderer();
        return done;
      }
      contents.close();
      return done;
    }
    if (this.closing !== null) return this.closing.done;
    let stay = (): void => undefined;
    const done = new Promise<boolean>((settle) => {
      const closed = () => {
        this.closing = null;
        settle(true);
      };
      contents.once('destroyed', closed);
      stay = () => {
        contents.off('destroyed', closed);
        this.closing = null;
        settle(false);
      };
    });
    this.closing = { stay, done };
    contents.close({ waitForBeforeUnload: true });
    return done;
  }

  private get responsive(): boolean {
    const failed = this.unresponsiveProcess;
    const pid = this.contents.getOSProcessId();
    return failed === null || pid <= 0 || failed.pid !== pid || failed.host !== this.contents.mainFrame.processId;
  }

  private hungAlone(): boolean {
    const renderer = this.contents.getOSProcessId();
    if (this.responsive || this.restarting || renderer <= 0) return false;
    const origins = new Set(
      this.contents.mainFrame.framesInSubtree
        .filter((frame) => !frame.isDestroyed() && frame.osProcessId === renderer && frame.origin !== 'null')
        .map((frame) => frame.origin),
    );
    return webContents
      .getAllWebContents()
      .every((other) => other === this.contents || other.isDestroyed() || !touches(other, renderer, origins));
  }

  private get strain(): Strain {
    return this.strains.current(this.contents.getOSProcessId(), this.profile);
  }

  private get share(): number {
    const strain = this.strain;
    return this.dialogOpen || strain.paused ? 0 : 1 / strain.factor;
  }

  driving(driven: Driven | null): void {
    this.driven = driven;
    this.placed.driven = driven !== null;
    if (driven !== null) this.clearProbe();
    driven?.watch({
      share: () => this.share,
      report: (responsive) => this.respond(responsive),
    });
    if (driven === null && this.held !== null && !this.held.told) this.surface(this.held);
  }

  restate(): void {
    this.changed(this.state());
    if (!this.responsive) this.emit((page) => ({ kind: 'unresponsive', page }));
    if (this.held?.told === true) this.tell(this.held.dialog);
    else if (this.leaving !== null) this.tell(this.leavingDialog());
  }

  private go(to: Navigation, settle: (settled: Settled) => void): void {
    const contents = this.contents;
    if (contents.isDestroyed()) {
      settle({ failure: { kind: 'missing', message: 'the page closed during the navigation' } });
      return;
    }
    const finish = (settled: Settled) => {
      if (this.going !== going) return;
      this.going = null;
      unhook();
      settle(settled);
    };
    const navigated = () => finish({ change: this.located() });
    const parsed = to.kind === 'url' || to.kind === 'reload' ? 'dom-ready' : 'did-navigate';
    const inPage = (_event: unknown, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) navigated();
    };
    const failed = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      finish({
        failure: {
          kind: 'navigation',
          code: `net::${description}`,
          message: `the navigation ${code === ABORTED ? 'was abandoned' : `failed with ${description}`}`,
        },
      });
    };
    const destroyed = () => finish({ failure: { kind: 'missing', message: 'the page closed during the navigation' } });
    const emitter = contents as unknown as NodeJS.EventEmitter;
    const unhook = () => {
      emitter.off(parsed, navigated);
      contents.off('did-navigate-in-page', inPage);
      contents.off('did-fail-provisional-load', failed);
      contents.off('did-fail-load', failed);
      contents.off('destroyed', destroyed);
    };
    const going: Going = { to, settle, unhook };
    this.going?.settle({ failure: { kind: 'navigation', code: 'net::ERR_ABORTED', message: 'another navigation replaced this one' } });
    this.going?.unhook();
    this.going = going;
    emitter.on(parsed, navigated);
    contents.on('did-navigate-in-page', inPage);
    contents.on('did-fail-provisional-load', failed);
    contents.on('did-fail-load', failed);
    contents.once('destroyed', destroyed);
    switch (to.kind) {
      case 'url':
        this.agentFor(to.url);
        contents.loadURL(to.url).catch(() => undefined);
        return;
      case 'back':
        contents.navigationHistory.goBack();
        return;
      case 'forward':
        contents.navigationHistory.goForward();
        return;
      case 'reload':
        if (this.responsive) {
          contents.reload();
          return;
        }
        this.driven?.swap();
        this.restarting = true;
        contents.once('render-process-gone', () => {
          this.emit((page) => ({ kind: 'swapped', page }));
          this.respond(true);
          contents.reload();
        });
        contents.forcefullyCrashRenderer();
        return;
      case 'stop':
        return;
    }
  }

  private agentFor(url: string): void {
    if (this.firefox === null || this.contents.isDestroyed()) return;
    const standing = this.contents.getUserAgent();
    if (isGoogleSignIn(url)) {
      if (standing !== this.firefox) this.contents.setUserAgent(this.firefox);
    } else if (standing === this.firefox) {
      this.contents.setUserAgent(this.contents.session.getUserAgent());
    }
  }

  get needsCpu(): boolean {
    return this.driven !== null ? this.driven.needsCpu : this.probe !== null && this.probe.phase !== 'unresponsive';
  }

  suspend(): void {
    this.budget.suspend();
    this.driven?.suspend();
  }

  sample(cpu: RendererCpu | null): void {
    if (this.driven !== null) {
      this.driven.sample(cpu);
      return;
    }
    const probe = this.probe;
    if (probe === null) return;
    if (probe.phase === 'starting') {
      if (cpu === null || this.share === 0) return;
      probe.phase = 'waiting';
      this.budget.start(cpu);
      const frame = this.contents.mainFrame;
      const process = frame.processId;
      const pid = this.contents.getOSProcessId();
      void probeFrame(this.contents).then(
        () => {
          if (this.probe !== probe) return;
          this.clearProbe();
          if (
            !this.contents.isDestroyed() &&
            !frame.isDestroyed() &&
            this.contents.mainFrame.processId === process &&
            this.contents.getOSProcessId() === pid
          )
            this.respond(true);
        },
        (error: unknown) => {
          if (this.probe !== probe) return;
          this.clearProbe();
          console.debug(`[tagma-desktop] the native renderer probe was not answered: ${String(error)}`);
        },
      );
    } else if (probe.phase === 'waiting' && this.budget.sample(cpu, this.share)) {
      probe.phase = 'unresponsive';
      this.respond(false);
    }
  }

  private clearProbe(): void {
    this.probe = null;
  }

  private probeRoot(): void {
    if (this.driven === null && this.probe === null) this.probe = { phase: 'starting' };
  }

  private respond(responsive: boolean): void {
    const process = responsive ? null : { pid: this.contents.getOSProcessId(), host: this.contents.mainFrame.processId };
    if (this.unresponsiveProcess?.pid === process?.pid && this.unresponsiveProcess?.host === process?.host) return;
    this.unresponsiveProcess = process;
    this.emit((page) => (responsive ? { kind: 'responsive', page } : { kind: 'unresponsive', page }));
  }

  private tell(dialog: Dialog | null): void {
    this.emit((page) => ({ kind: 'dialog', page, dialog }));
  }

  private emit(make: (page: PageId) => HostEvent): void {
    if (this.id !== null) this.events.event(this, make(this.id));
  }

  private changed(change: PageChange): void {
    this.emit((page) => ({ kind: 'changed', page, change }));
  }

  private runDialog(info: RunDialog, callback: (accept: boolean, text: string) => void): void {
    if (info.dialogType === 'prompt' || this.held !== null) {
      callback(false, '');
      return;
    }
    const url = info.frame?.url ?? this.contents.getURL();
    const held: Held = {
      dialog: { kind: info.dialogType, message: info.messageText, prompt: null, url },
      callback,
      box: null,
      told: false,
    };
    this.held = held;
    if (this.driven === null) this.surface(held);
  }

  private surface(held: Held): void {
    held.told = true;
    this.tell(held.dialog);
    const window = this.events.window(this);
    if (window === null) return;
    const box = new AbortController();
    held.box = box;
    const buttons =
      held.dialog.kind === 'confirm'
        ? { buttons: ['OK', 'Cancel'], defaultId: 0, cancelId: 1 }
        : { buttons: ['OK'], defaultId: 0, cancelId: 0 };
    dialog.showMessageBox(window, { message: held.dialog.message, signal: box.signal, ...buttons }).then(
      (result) => {
        if (this.held === held && !box.signal.aborted) this.answer(result.response === 0, null);
      },
      (error: unknown) => console.warn(`[tagma-desktop] a page dialog did not show: ${String(error)}`),
    );
  }

  private holdLeaving(): void {
    const going = this.going;
    this.going = null;
    going?.unhook();
    const abandoned = () => going?.settle({ failure: { kind: 'navigation', code: 'net::ERR_ABORTED', message: STAYED } });
    const closing = this.closing;
    if (closing !== null) {
      abandoned();
      this.leaving = {
        retry: () => {
          if (!this.contents.isDestroyed()) this.contents.close({ waitForBeforeUnload: true });
        },
        stay: closing.stay,
      };
    } else {
      this.leaving = going === null ? { retry: null, stay: null } : { retry: () => this.go(going.to, going.settle), stay: abandoned };
    }
    setImmediate(() => {
      if (this.leaving !== null) this.tell(this.leavingDialog());
    });
  }

  private leavingDialog(): Dialog {
    return { kind: 'beforeunload', message: '', prompt: null, url: this.contents.getURL() };
  }

  private finishNavigation(url: string, main: boolean, process: number | undefined, routing: number | undefined): void {
    const key = main
      ? this.contents.mainFrame.frameTreeNodeId
      : process === undefined || routing === undefined
        ? undefined
        : webFrameMain.fromId(process, routing)?.frameTreeNodeId;
    if (key !== undefined && this.pending.has(key)) {
      if (this.pending.get(key) === url) this.pending.delete(key);
      return;
    }
    for (const [key, address] of this.pending) {
      if (typeof key !== 'symbol' || address !== url) continue;
      this.pending.delete(key);
      return;
    }
  }

  private follow(): void {
    const contents = this.contents;
    const emitter = contents as unknown as NodeJS.EventEmitter;
    emitter.removeAllListeners('-run-dialog');
    emitter.on('-run-dialog', (info: RunDialog, callback: (accept: boolean, text: string) => void) => this.runDialog(info, callback));
    emitter.on('-cancel-dialogs', () => {
      const held = this.held;
      if (held === null) return;
      this.held = null;
      held.box?.abort();
      if (held.told) this.tell(null);
    });
    contents.on('will-prevent-unload', (event) => {
      if (this.allowLeave) {
        this.allowLeave = false;
        event.preventDefault();
      } else if (this.leaving === null) {
        this.holdLeaving();
      }
    });
    contents.on('will-navigate', (event, url) => {
      if (!allowedUrl(url)) event.preventDefault();
    });
    contents.on('will-frame-navigate', (event) => {
      if (this.restrictions.block(event.url) !== null) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!allowedUrl(url) || this.restrictions.block(url) !== null) event.preventDefault();
    });
    const identified = (details: Event<WebContentsDidStartNavigationEventParams>) => {
      if (details.isSameDocument) return;
      const key = details.isMainFrame ? contents.mainFrame.frameTreeNodeId : details.frame?.frameTreeNodeId;
      this.pending.set(key ?? Symbol(), details.url);
      if (details.isMainFrame) this.agentFor(details.url);
    };
    contents.on('did-start-navigation', identified);
    contents.on('did-redirect-navigation', (details) => {
      const key = details.isMainFrame ? contents.mainFrame.frameTreeNodeId : details.frame?.frameTreeNodeId;
      if (key !== undefined && this.pending.has(key)) this.pending.set(key, details.url);
    });
    contents.on('did-frame-navigate', (_event, url, _code, _status, main, process, routing) => {
      if (main && this.unresponsiveProcess !== null && this.responsive) {
        this.clearProbe();
        this.respond(true);
        this.probeRoot();
      }
      this.finishNavigation(url, main, process, routing);
    });
    const failed = (
      _event: Event,
      _code: number,
      _description: string,
      url: string,
      main: boolean,
      process: number | undefined,
      routing: number | undefined,
    ) => this.finishNavigation(url, main, process, routing);
    contents.on('did-fail-provisional-load', failed);
    contents.on('did-fail-load', failed);
    contents.on('did-start-loading', () => this.changed({ loading: true }));
    contents.on('did-stop-loading', () => {
      this.pending.clear();
      this.agentFor(contents.getURL());
      this.changed({ ...this.state(), loading: false });
    });
    contents.on('did-navigate', () => this.changed(this.state()));
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) this.changed(this.state());
    });
    contents.on('page-title-updated', (_event, title) => this.changed({ title }));
    contents.on('page-favicon-updated', (_event, favicons) => this.changed({ favicon: favicons[0] ?? null }));
    contents.on('unresponsive', () => this.probeRoot());
    contents.on('responsive', () => this.probeRoot());
    contents.on('render-process-gone', () => {
      this.pending.clear();
      this.clearProbe();
      this.unresponsiveProcess = null;
      this.held = null;
      this.leaving = null;
      if (this.closing !== null) contents.close();
      if (this.restarting) this.restarting = false;
      else this.emit((page) => ({ kind: 'crashed', page }));
    });
    contents.on('devtools-closed', () => this.emit((page) => ({ kind: 'released', page })));
    contents.once('destroyed', () => {
      this.pending.clear();
      this.restrictions.disconnect();
      this.clearProbe();
      this.events.closed(this);
    });
  }
}
