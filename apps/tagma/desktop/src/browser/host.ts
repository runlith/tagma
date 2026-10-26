import { totalmem } from 'node:os';
import type { HostEvent } from '@tagma/server/browser/contract/wire/host';
import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Call, Failure } from '@tagma/server/desktop-browser/contract/wire/channel';
import { BaseWindow, type BrowserWindow, type Event, type Input, type WebContents, WebContentsView } from 'electron';
import type { Chord, FramedChord, PageKey } from '../bridge.js';
import { BROWSER } from '../channels.js';
import { devToolsChord, newWindowChord, toggleDevTools } from '../projectWindows.js';
import { tabCommandOf } from '../tabKeys.js';
import { chordOf, sameChord } from './chords.js';
import type { Executor, Reporter } from './connection.js';
import { forwardFramed } from './framedKeys.js';
import { Driven } from './driven.js';
import { readKey } from './keychain.js';
import { showPageMenu } from './menu.js';
import { allowedUrl, HeldPage, type PageEvents, type Settled, viewPreferences } from './page.js';
import { Placement } from './placement.js';
import { showPopup } from './popups.js';
import type { Profiles } from './profiles.js';

const GESTURE_MS = 1_000;
const TAB_BUDGET = 4;
const TAB_WINDOW_MS = 2_000;
const ACTIVATING = new Set(['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'char', 'touchStart', 'touchEnd', 'gestureTap']);

export const liveLimit = (): number => Math.max(4, Math.floor(totalmem() / 2 ** 30));

export type HostActs = {
  readonly newWindow: (from: BrowserWindow) => void;
};

type Service = { readonly view: WebContentsView; readonly window: BaseWindow };

export class BrowserHost implements Executor {
  readonly placement: Placement;
  private reporter: Reporter | null = null;
  private readonly pages = new Map<string, HeldPage>();
  private readonly byId = new Map<PageId, HeldPage>();
  private readonly byContents = new Map<WebContents, HeldPage>();
  private readonly popups = new Map<HeldPage, BaseWindow>();
  private readonly sessions = new Map<number, Driven>();
  private readonly holds = new Map<number, HeldPage>();
  private readonly services = new Map<string, Service>();
  private readonly chords = new Map<WebContents, readonly Chord[]>();
  private readonly framed = new Map<WebContents, readonly FramedChord[]>();
  private locals = 0;
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
      event: (_page, event) => this.reporter?.event(event),
      closed: (page) => this.closed(page),
      window: (page) => this.popups.get(page) ?? page.placed.shown?.window ?? null,
    };
  }

  page(id: string): HeldPage | undefined {
    return this.byId.get(id as PageId);
  }

  keys(owner: WebContents, chords: readonly Chord[], framed: readonly FramedChord[]): void {
    if (!this.chords.has(owner)) {
      owner.once('destroyed', () => {
        this.chords.delete(owner);
        this.framed.delete(owner);
      });
      forwardFramed(owner, () => this.framed.get(owner) ?? []);
    }
    this.chords.set(owner, chords);
    this.framed.set(owner, framed);
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
    for (const driven of this.sessions.values()) driven.detach();
    this.sessions.clear();
    for (const [hold, page] of this.holds) this.placement.release(page.placed, hold);
    this.holds.clear();
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
        if (this.byId.has(call.page)) return answer();
        this.profiles.session(call.profile);
        const page = this.track(HeldPage.create(this.local(), call.page, call.profile, null, this.identity, this.events));
        page.load(call.url, call.history);
        return answer();
      }
      case 'adopt': {
        const page = this.pages.get(call.local);
        if (page === undefined || page.id !== null) return missing(call.local);
        page.id = call.page;
        this.byId.set(call.page, page);
        answer();
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
      case 'session': {
        const page = this.byId.get(call.page);
        if (page === undefined) return missing(call.page);
        page.driven?.detach();
        const driven = Driven.attach(page.contents, call.session, reporter, (gone) => {
          this.sessions.delete(gone.session);
          if (page.driven !== gone) return;
          page.driving(null);
        });
        if (!(driven instanceof Driven)) return fail(driven);
        this.sessions.set(call.session, driven);
        page.driving(driven);
        return answer();
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
    if (page.id !== null) this.byId.set(page.id, page);
    this.byContents.set(page.contents, page);
    this.placement.add(page.placed);
    this.police(page);
    this.trim(page);
    return page;
  }

  private closed(page: HeldPage): void {
    this.pages.delete(page.local);
    if (page.id !== null && this.byId.get(page.id) === page) this.byId.delete(page.id);
    this.byContents.delete(page.contents);
    this.popups.delete(page);
    this.placement.remove(page.placed);
    for (const [hold, held] of this.holds) if (held === page) this.holds.delete(hold);
    if (!page.unloading && page.id !== null) this.reporter?.event({ kind: 'closed', page: page.id });
  }

  private opened(page: HeldPage, opener: HeldPage, url: string): void {
    this.reporter?.event({ kind: 'opened', local: page.local, profile: page.profile, opener: opener.id, url });
  }

  private openTab(opener: HeldPage, url: string): void {
    const page = this.track(HeldPage.create(this.local(), null, opener.profile, opener.id, this.identity, this.events));
    page.load(url, null);
    this.opened(page, opener, url);
  }

  private police(page: HeldPage): void {
    const contents = page.contents;
    let gesture: number | null = null;
    const opens: number[] = [];
    contents.on('input-event', (_event, input) => {
      if (ACTIVATING.has(input.type)) gesture = Date.now();
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
      if (!allowedUrl(url) || !(click || budget())) return { action: 'deny' };
      if (frameName === '' && (disposition === 'foreground-tab' || disposition === 'background-tab')) {
        this.openTab(page, url);
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const adopted = (options as { readonly webContents?: WebContents }).webContents;
          const popup = HeldPage.create(this.local(), null, page.profile, page.id, this.identity, this.events, adopted);
          this.popups.set(
            popup,
            showPopup(popup, { width: options.width, height: options.height }, () => this.placement.settle(popup.placed)),
          );
          this.track(popup);
          if (adopted === undefined) {
            const posted =
              postBody === undefined
                ? {}
                : { postData: postBody.data, extraHeaders: `content-type: ${postBody.contentType}; boundary=${postBody.boundary}` };
            popup.contents.loadURL(url, { httpReferrer: referrer, ...posted }).catch(() => undefined);
          }
          this.opened(popup, page, url);
          return popup.contents;
        },
      };
    });
    contents.on('before-input-event', (event, input) => this.key(page, event, input));
    contents.on('context-menu', (_event, params) => {
      const window = this.events.window(page);
      if (window !== null) showPageMenu(window, contents, params, { openTab: (url) => this.openTab(page, url) });
    });
    contents.on('found-in-page', (_event, result) => {
      const window = page.placed.shown?.window;
      if (page.id !== null && window !== undefined && !window.isDestroyed()) {
        window.webContents.send(BROWSER.found, { page: page.id, matches: result.matches, active: result.activeMatchOrdinal });
      }
    });
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
    if (devToolsChord(input)) {
      event.preventDefault();
      toggleDevTools(window);
      return;
    }
    const chord = chordOf(input);
    const published = this.chords.get(window.webContents) ?? [];
    if (page.id === null || (tabCommandOf(input, mac) === null && !published.some((held) => sameChord(held, chord)))) return;
    event.preventDefault();
    window.webContents.send(BROWSER.key, { page: page.id, chord, frame: null } satisfies PageKey);
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
