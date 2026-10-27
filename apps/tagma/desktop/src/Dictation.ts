import { createDesktopInputHost } from '@runlith/desktop-input/DesktopInputHost';
import type { DesktopAccessibilityState, DesktopHold, DesktopInputHost, HoldBinding } from '@runlith/desktop-input/contract/types';
import { app, BrowserWindow, clipboard, ipcMain, type WebContents } from 'electron';
import type { GlobalState, HeldKey, Stroke } from './bridge.js';
import { DICTATION } from './channels.js';
import type { Fronts } from './fronts.js';
import { bindingOf } from './keyCodes.js';

const RESTART_AFTER_MS = 60_000;

type Armed = { readonly key: HeldKey; readonly binding: HoldBinding };

export interface Pill {
  readonly contents: WebContents;
  stroke(stroke: Stroke): boolean;
  lost(reason: string): void;
  show(shown: boolean): void;
  close(): void;
}

export class Dictation {
  private armed: Armed | null = null;
  private input: DesktopInputHost | null = null;
  private trusted = false;
  private fault: string | null = null;
  private pill: Pill | null = null;
  private pillReady = false;
  private pillFault: string | null = null;
  private gesture: 'local' | 'global' | null = null;
  private shown = false;
  private interrupted = false;
  private restartedAt = 0;
  private state: GlobalState = { kind: 'off' };

  constructor(
    private readonly open: (down: (reason: string | null) => void) => Pill,
    private readonly helper: string,
    private readonly fronts: Fronts,
  ) {}

  install(): void {
    ipcMain.on(DICTATION.arm, (event, key: HeldKey | null) => {
      if (this.fronts.trusts(event.senderFrame?.url)) void this.arm(key);
    });
    ipcMain.handle(DICTATION.state, (event) => (this.fronts.trusts(event.senderFrame?.url) ? this.state : { kind: 'off' }));
    ipcMain.on(DICTATION.prompt, (event) => {
      if (this.fronts.trusts(event.senderFrame?.url)) this.input?.promptAccessibility();
    });
    ipcMain.on(DICTATION.ready, (event) => {
      if (!this.fromPill(event.sender)) return;
      this.pillReady = true;
      this.pillFault = null;
      this.sync();
    });
    ipcMain.on(DICTATION.show, (event, shown: boolean) => {
      if (!this.fromPill(event.sender)) return;
      this.shown = shown === true;
      this.pill?.show(this.shown);
      this.input?.watchEscape(this.shown);
    });
    ipcMain.on(DICTATION.keep, (event, text: string) => {
      if (this.fromPill(event.sender) && typeof text === 'string' && text !== '') void clipboard.writeText(text);
    });
    ipcMain.handle(DICTATION.paste, (event, text: string) =>
      this.fromPill(event.sender) && typeof text === 'string' ? this.paste(text) : false,
    );
    app.on('browser-window-focus', () => {
      this.sync();
      if (this.armed !== null && !this.trusted) this.input?.recheckAccessibility();
    });
    app.on('browser-window-blur', () => setImmediate(() => this.sync()));
  }

  async dispose(): Promise<void> {
    await this.disarm(null);
  }

  private async arm(key: HeldKey | null): Promise<void> {
    if (key === null) {
      if (this.armed !== null || this.state.kind !== 'off') await this.disarm(null);
      return;
    }
    if (this.armed !== null && this.input !== null && same(this.armed.key, key)) return;
    const binding = bindingOf(key);
    if (binding === null) {
      await this.disarm(`The key ${key.code} cannot be held outside the Tagma window; choose a letter, a digit, a function key or Space.`);
      return;
    }
    this.armed = { key, binding };
    if (this.input === null) await this.start();
    else this.sync();
  }

  private async start(): Promise<void> {
    const input = createDesktopInputHost({ binaryPath: this.helper });
    this.input = input;
    this.trusted = false;
    this.fault = null;
    input.onHold((hold) => this.hold(hold));
    input.onEscape(() => {
      if (this.shown) this.pill?.stroke('cancel');
    });
    input.onAccessibilityChange((accessibility) => this.trust(input, accessibility));
    input.onLost((reason) => void this.lose(input, reason));
    this.sync();
    const started = await input.start();
    if (this.input !== input) return;
    if (started.status === 'unsupported') {
      this.input = null;
      this.fault =
        started.issue.details?.reason === undefined ? started.issue.message : `${started.issue.message} ${started.issue.details.reason}`;
      this.sync();
      await input.dispose();
      return;
    }
    this.trust(input, started.accessibility);
  }

  private trust(input: DesktopInputHost, accessibility: DesktopAccessibilityState): void {
    if (this.input !== input) return;
    const was = this.trusted;
    this.trusted = accessibility.trusted && accessibility.tapActive;
    if (was && !this.trusted) this.interrupt('Accessibility for Tagma was turned off, so the key and the paste stopped');
    this.fault =
      accessibility.trusted && !accessibility.tapActive
        ? 'macOS granted Accessibility but refused the key tap; quit and reopen Tagma.'
        : null;
    if (this.trusted && this.pill === null) this.pill = this.open((reason) => this.pillDown(reason));
    this.sync();
  }

  private pillDown(reason: string | null): void {
    this.pillReady = false;
    this.pillFault = reason;
    if (this.gesture === 'global') this.gesture = null;
    this.shown = false;
    this.input?.watchEscape(false);
    this.sync();
  }

  private async lose(input: DesktopInputHost, reason: string): Promise<void> {
    if (this.input !== input) return;
    this.input = null;
    this.trusted = false;
    this.interrupt(reason);
    await input.dispose();
    if (this.armed !== null && Date.now() - this.restartedAt > RESTART_AFTER_MS) {
      this.restartedAt = Date.now();
      await this.start();
      return;
    }
    this.fault = reason;
    this.sync();
  }

  private interrupt(reason: string): void {
    if (this.gesture === 'global' || this.shown) {
      this.interrupted = true;
      this.pill?.lost(reason);
    }
    this.gesture = null;
  }

  private hold(hold: DesktopHold): void {
    if (hold.transition === 'start') {
      if (this.gesture !== null) return;
      this.gesture = this.live() && !appFocused() && this.pill?.stroke('press') === true ? 'global' : 'local';
      if (this.gesture === 'global') this.interrupted = false;
      return;
    }
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture === 'global') this.pill?.stroke(hold.transition === 'end' ? 'lift' : 'cancel');
  }

  private live(): boolean {
    return this.armed !== null && this.trusted && this.pill !== null && this.pillReady;
  }

  private sync(): void {
    const input = this.input;
    if (input !== null) {
      input.bind(this.armed !== null && this.trusted ? this.armed.binding : null);
      input.swallow(this.live() && !appFocused());
    }
    this.publish(this.current());
  }

  private current(): GlobalState {
    if (this.fault !== null) return { kind: 'unavailable', reason: this.fault };
    if (this.armed === null) return { kind: 'off' };
    if (this.input === null) return { kind: 'starting' };
    if (!this.trusted) return { kind: 'untrusted' };
    if (this.pillFault !== null) return { kind: 'unavailable', reason: `${this.pillFault}; retrying.` };
    return this.pillReady ? { kind: 'ready' } : { kind: 'starting' };
  }

  private async paste(text: string): Promise<boolean> {
    const outcome = this.input === null || this.interrupted ? null : await this.input.paste(text);
    if (outcome?.ok === true) return true;
    if ((await clipboard.readText()) !== text) await clipboard.writeText(text);
    return false;
  }

  private async disarm(fault: string | null): Promise<void> {
    this.armed = null;
    this.gesture = null;
    this.shown = false;
    this.trusted = false;
    this.pill?.close();
    this.pill = null;
    this.pillReady = false;
    this.pillFault = null;
    const input = this.input;
    this.input = null;
    this.fault = fault;
    this.publish(this.current());
    await input?.dispose();
  }

  private fromPill(sender: WebContents): boolean {
    return this.pill !== null && sender === this.pill.contents;
  }

  private publish(state: GlobalState): void {
    if (same(this.state, state)) return;
    this.state = state;
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(DICTATION.changed, state);
  }
}

const appFocused = (): boolean => BrowserWindow.getFocusedWindow() !== null;

const same = (left: object, right: object): boolean => JSON.stringify(left) === JSON.stringify(right);
