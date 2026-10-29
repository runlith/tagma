import type { HostEvent, Navigation, PageChange, Strain } from '@tagma/server/browser/contract/wire/host';
import {
  type DomainBlock,
  type DomainPolicy,
  domainBlock,
  type Restriction,
  type RestrictionState,
} from '@tagma/server/browser/contract/wire/domains';
import type { PageId, ProfileId } from '@tagma/server/browser/contract/wire/ids';
import type { Dialog, History } from '@tagma/server/browser/contract/wire/page';
import type { Failure } from '@tagma/server/desktop-browser/contract/wire/channel';
import { type BaseWindow, dialog, type WebContents, WebContentsView, type WebFrameMain } from 'electron';
import type { Driven } from './driven.js';
import { firefoxAgent, isGoogleSignIn } from './identity.js';
import { type Placed, VIEWPORT } from './placement.js';
import { partitionOf } from './profiles.js';

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

const STAYED = 'the page asked to stay, and leaving it was dismissed';

type RunDialog = {
  readonly frame: WebFrameMain | null;
  readonly dialogType: 'alert' | 'confirm' | 'prompt';
  readonly messageText: string;
};

export type GateFailure = { readonly block: DomainBlock; seen: boolean };

export type NavigationGate = {
  policy: DomainPolicy;
  source: HeldPage;
  watch: number | null;
  pending: GateFailure | null;
  failure: GateFailure | null;
};

export type NavigationAdmission = { readonly gate: NavigationGate | null; readonly changes: readonly Restriction[] };

export type PageEvents = {
  readonly revision: () => number;
  readonly event: (page: HeldPage, event: HostEvent) => void;
  readonly closed: (page: HeldPage) => void;
  readonly window: (page: HeldPage) => BaseWindow | null;
  readonly navigation: (page: HeldPage, active: boolean) => void;
  readonly blocked: (watch: number, block: DomainBlock) => void;
};

export const viewPreferences = (profile: string) =>
  ({ partition: partitionOf(profile), sandbox: true, contextIsolation: true, nodeIntegration: false }) as const;

export class HeldPage {
  id: PageId | null;
  driven: Driven | null = null;
  unloading = false;
  readonly placed: Placed;
  private gate: NavigationGate | null = null;
  private restrictionRevision: number;
  private parent: HeldPage | null = null;
  private readonly children = new Set<HeldPage>();
  private held: Held | null = null;
  private going: Going | null = null;
  private leaving: Leaving | null = null;
  private closing: Closing | null = null;
  private allowLeave = false;
  private responsive = true;
  private restarting = false;
  private readonly strains = new Map<number, Strain>();
  private unresponsive: ReturnType<typeof setInterval> | null = null;
  private readonly firefox: string | null;

  constructor(
    readonly local: string,
    id: PageId | null,
    readonly profile: ProfileId,
    readonly opener: PageId | null,
    readonly view: WebContentsView,
    identity: 'cleaned' | 'native',
    private readonly events: PageEvents,
  ) {
    this.id = id;
    this.restrictionRevision = events.revision();
    this.firefox = identity === 'cleaned' ? firefoxAgent() : null;
    this.placed = { view, home: null, parking: null, shown: null, size: { ...VIEWPORT }, holds: new Set(), shownAt: Date.now() };
    this.follow();
  }

  static create(
    local: string,
    id: PageId | null,
    profile: ProfileId,
    opener: PageId | null,
    identity: 'cleaned' | 'native',
    events: PageEvents,
    contents?: WebContents,
  ): HeldPage {
    const view = new WebContentsView(
      contents === undefined
        ? { webPreferences: viewPreferences(profile) }
        : { webPreferences: viewPreferences(profile), webContents: contents },
    );
    return new HeldPage(local, id, profile, opener, view, identity, events);
  }

  get contents(): WebContents {
    return this.view.webContents;
  }

  get closingNow(): boolean {
    return this.closing !== null;
  }

  get dialogOpen(): boolean {
    return this.held !== null || this.leaving !== null;
  }

  get restricted(): boolean {
    return this.gate !== null;
  }

  get restriction(): RestrictionState {
    return { restricted: this.restricted, revision: this.restrictionRevision };
  }

  state(): PageChange {
    const contents = this.contents;
    const history = contents.navigationHistory;
    return {
      url: contents.getURL() || 'about:blank',
      title: contents.getTitle(),
      loading: contents.isLoading(),
      back: history.canGoBack(),
      forward: history.canGoForward(),
      history: { entries: history.getAllEntries().map((entry) => ({ url: entry.url, title: entry.title })), at: history.getActiveIndex() },
    };
  }

  navigation(policy: DomainPolicy | null, watch: number | null): NavigationAdmission {
    if (policy === null || (policy.allowed.length === 0 && policy.blocked.length === 0)) {
      return { gate: null, changes: this.operated(true) };
    }
    const pending = this.gate?.pending;
    const previous = pending != null && !pending.seen ? pending : null;
    if (this.gate !== null) {
      this.gate.policy = policy;
      this.gate.source = this;
      this.gate.watch = watch;
      this.gate.pending = previous;
      this.gate.failure = previous;
    } else {
      this.restrictionRevision = this.events.revision();
      this.gate = { policy, source: this, watch, pending: previous, failure: previous };
    }
    this.events.navigation(this, true);
    const changes: Restriction[] = [];
    for (const page of this.family()) {
      if (page !== this) page.inheritGate(this.gate);
      if (page.id !== null) changes.push({ page: page.id, ...page.restriction });
    }
    return { gate: this.gate, changes };
  }

  inherit(opener: HeldPage): void {
    this.parent?.children.delete(this);
    this.parent = opener;
    opener.children.add(this);
    if (opener.gate !== null) this.inheritGate(opener.gate);
  }

  private inheritGate(gate: NavigationGate): void {
    if (this.gate === null) {
      this.restrictionRevision = this.events.revision();
      this.gate = { policy: gate.policy, source: gate.source, watch: null, pending: null, failure: null };
    } else {
      this.gate.policy = gate.policy;
      this.gate.source = gate.source;
    }
    this.events.navigation(this, true);
  }

  operated(snapshot = false): readonly Restriction[] {
    const changes: Restriction[] = [];
    for (const page of this.family()) {
      const restricted = page.gate !== null;
      if (restricted) {
        page.gate = null;
        page.restrictionRevision = page.events.revision();
        page.events.navigation(page, false);
      }
      if (page.id !== null && (snapshot || restricted)) changes.push({ page: page.id, ...page.restriction });
    }
    return changes;
  }

  private *family(): Generator<HeldPage> {
    let root: HeldPage = this;
    while (root.parent !== null) root = root.parent;
    const pending: HeldPage[] = [root];
    while (pending.length > 0) {
      const page = pending.pop()!;
      yield page;
      for (const child of page.children) pending.push(child);
    }
  }

  block(url: string): DomainBlock | null {
    const gate = this.gate;
    if (gate === null) return null;
    const block = domainBlock(gate.policy, url);
    if (block === null) return null;
    this.refuseNavigation(block);
    if (gate.source !== this) gate.source.refuseNavigation(block);
    return block;
  }

  private refuseNavigation(block: DomainBlock): void {
    const gate = this.gate;
    if (gate !== null && (gate.watch === null || gate.failure === null)) {
      const pending = gate.pending;
      gate.pending = pending !== null && !pending.seen ? pending : { block, seen: false };
      if (gate.watch !== null) {
        gate.failure = gate.pending;
        this.events.blocked(gate.watch, gate.failure.block);
      }
    }
    this.emit((page) => ({ kind: 'navigation-blocked', page, block }));
  }

  load(url: string, history: History | null): DomainBlock | null {
    const target = history !== null && history.entries.length > 0 ? (history.entries[history.at]?.url ?? url) : url;
    const block = this.block(target);
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
    const block = target === undefined ? null : this.block(target);
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
    this.allowLeave = true;
    leaving.retry?.();
  }

  close(ask: boolean): Promise<boolean> {
    const contents = this.contents;
    if (contents.isDestroyed()) return Promise.resolve(true);
    if (!ask || !this.responsive) {
      const done = this.closing?.done ?? new Promise<boolean>((settle) => contents.once('destroyed', () => settle(true)));
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

  strain(hold: number, strain: Strain | null): void {
    if (strain === null) this.strains.delete(hold);
    else this.strains.set(hold, strain);
  }

  private get strainFactor(): number {
    return Math.max(1, ...[...this.strains.values()].map((strain) => strain.factor));
  }

  private get strainPaused(): boolean {
    return [...this.strains.values()].some((strain) => strain.paused);
  }

  driving(driven: Driven | null): void {
    this.driven = driven;
    if (driven !== null) this.clearUnresponsive();
    driven?.probe({
      paused: () => this.dialogOpen || this.strainPaused,
      factor: () => this.strainFactor,
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
    const finish = (settled: Settled) => {
      if (this.going !== going) return;
      this.going = null;
      unhook();
      settle(settled);
    };
    const navigated = () => finish({ change: this.state() });
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

  private clearUnresponsive(): void {
    if (this.unresponsive !== null) clearInterval(this.unresponsive);
    this.unresponsive = null;
  }

  private nativeUnresponsive(): void {
    if (this.driven !== null || this.unresponsive !== null) return;
    if (!this.strainPaused && !this.dialogOpen && this.strainFactor === 1) {
      this.respond(false);
      return;
    }
    let previous = performance.now();
    let waited = 0;
    this.unresponsive = setInterval(() => {
      const now = performance.now();
      if (!this.strainPaused && !this.dialogOpen) waited += (now - previous) / this.strainFactor;
      previous = now;
      if (waited < 5_000) return;
      this.clearUnresponsive();
      this.respond(false);
    }, 1_000);
  }

  private respond(responsive: boolean): void {
    if (this.responsive === responsive) return;
    this.responsive = responsive;
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
      this.leaving = { retry: () => this.contents.close({ waitForBeforeUnload: true }), stay: closing.stay };
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

  private disconnect(): void {
    for (const page of this.family()) {
      if (page !== this && page.gate?.source === this) page.gate.source = page;
    }
    if (this.gate !== null) {
      this.gate.source = this;
      this.gate.watch = null;
      this.gate.pending = null;
      this.gate.failure = null;
      this.gate = null;
      this.restrictionRevision = this.events.revision();
    }
    let parent = this.parent;
    parent?.children.delete(this);
    this.parent = null;
    for (const child of this.children) {
      child.parent = parent;
      if (parent === null) parent = child;
      else parent.children.add(child);
    }
    this.children.clear();
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
      if (this.block(event.url) !== null) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!allowedUrl(url) || this.block(url) !== null) event.preventDefault();
    });
    const identified = (details: { readonly url: string; readonly isMainFrame: boolean; readonly isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) this.agentFor(details.url);
    };
    contents.on('did-start-navigation', identified);
    contents.on('did-start-loading', () => this.changed({ loading: true }));
    contents.on('did-stop-loading', () => {
      this.agentFor(contents.getURL());
      this.changed({ ...this.state(), loading: false });
    });
    contents.on('did-navigate', () => this.changed(this.state()));
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) this.changed(this.state());
    });
    contents.on('page-title-updated', (_event, title) => this.changed({ title }));
    contents.on('page-favicon-updated', (_event, favicons) => this.changed({ favicon: favicons[0] ?? null }));
    contents.on('unresponsive', () => this.nativeUnresponsive());
    contents.on('responsive', () => {
      this.clearUnresponsive();
      this.respond(true);
    });
    contents.on('render-process-gone', () => {
      this.clearUnresponsive();
      this.held = null;
      this.leaving = null;
      if (this.closing !== null) contents.close();
      if (this.restarting) this.restarting = false;
      else this.emit((page) => ({ kind: 'crashed', page }));
    });
    contents.on('devtools-closed', () => this.emit((page) => ({ kind: 'released', page })));
    contents.once('destroyed', () => {
      this.disconnect();
      this.clearUnresponsive();
      this.strains.clear();
      this.events.closed(this);
    });
  }
}
