import { Probe, type RendererCpu } from '@runlith/cdp/probe';
import type { Failure } from '@tagma/server/desktop-browser/contract/wire/channel';
import type { Event, WebContents } from 'electron';
import type { Reporter, SessionEnd } from './connection.js';

const UNRESPONSIVE_CPU_MS = 5_000;

type Command = { readonly id: number; readonly method: string; readonly params?: object; readonly sessionId?: string };

const MOUSE: Readonly<Record<string, readonly string[]>> = {
  mousePressed: ['mouseDown'],
  mouseReleased: ['mouseUp'],
  mouseMoved: ['mouseMove'],
  mouseWheel: ['mouseWheel'],
};

const KEY: Readonly<Record<string, readonly string[]>> = {
  keyDown: ['rawKeyDown', 'keyDown', 'char'],
  rawKeyDown: ['rawKeyDown', 'keyDown', 'char'],
  char: ['char'],
  keyUp: ['keyUp'],
};

const injectedTypes = (command: Command): readonly string[] => {
  const type = (command.params as { readonly type?: unknown } | undefined)?.type;
  if (typeof type !== 'string') return [];
  if (command.method === 'Input.dispatchMouseEvent') return MOUSE[type] ?? [];
  if (command.method === 'Input.dispatchKeyEvent') return KEY[type] ?? [];
  if (command.method === 'Input.dispatchTouchEvent') return [type];
  return [];
};

export type Probed = {
  readonly share: () => number;
  readonly report: (responsive: boolean) => void;
};

export class Driven {
  private ended = false;
  private probed: Probed | null = null;
  private readonly budget = new Probe(UNRESPONSIVE_CPU_MS);
  private asking = false;
  private silent = false;
  private readonly injected = new Map<number, readonly string[]>();

  private leaveDialog = false;

  private readonly message = (_event: Event, method: string, params: unknown, sessionId: string) => {
    if (sessionId === '' && method === 'Page.javascriptDialogOpening' && (params as { readonly type?: string }).type === 'beforeunload') {
      this.leaveDialog = true;
      return;
    }
    if (sessionId === '' && method === 'Page.javascriptDialogClosed' && this.leaveDialog) {
      this.leaveDialog = false;
      return;
    }
    this.reporter.cdp(this.session, sessionId === '' ? JSON.stringify({ method, params }) : JSON.stringify({ method, params, sessionId }));
  };

  private readonly detached = (_event: Event, reason: string) =>
    this.close(this.contents.isDevToolsOpened() ? 'taken' : reason === 'target closed' ? 'closed' : 'detached');

  private constructor(
    private readonly contents: WebContents,
    readonly session: number,
    private readonly reporter: Reporter,
    private readonly gone: (driven: Driven) => void,
  ) {}

  static attach(contents: WebContents, session: number, reporter: Reporter, gone: (driven: Driven) => void): Driven | Failure {
    if (contents.isDestroyed()) return { kind: 'missing', message: 'the page closed before the session attached' };
    try {
      contents.debugger.attach('1.3');
    } catch (error) {
      return contents.isDevToolsOpened()
        ? { kind: 'taken', message: 'DevTools of the operator hold this page' }
        : { kind: 'refused', message: `the page debugger did not attach: ${String(error)}`, unblock: ['make the call again'] };
    }
    const driven = new Driven(contents, session, reporter, gone);
    contents.debugger.on('message', driven.message);
    contents.debugger.on('detach', driven.detached);
    return driven;
  }

  command(text: string): void {
    if (this.ended) return;
    let command: Command;
    try {
      command = JSON.parse(text) as Command;
    } catch (error) {
      console.warn(`[tagma-desktop] a CDP command was unreadable: ${String(error)}`);
      return;
    }
    if (this.contents.isDestroyed()) {
      this.close('closed');
      return;
    }
    const injected = injectedTypes(command);
    if (injected.length > 0) this.injected.set(command.id, injected);
    const answered = () => {
      this.injected.delete(command.id);
    };
    const failed = (error: unknown) => {
      answered();
      this.reporter.cdp(
        this.session,
        JSON.stringify({ id: command.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }),
      );
    };
    try {
      this.contents.debugger.sendCommand(command.method, command.params, command.sessionId).then((result: unknown) => {
        answered();
        this.reporter.cdp(this.session, JSON.stringify({ id: command.id, result }));
      }, failed);
    } catch (error) {
      failed(error);
    }
  }

  injects(type: string): boolean {
    for (const types of this.injected.values()) if (types.includes(type)) return true;
    return false;
  }

  watch(probed: Probed): void {
    if (!this.ended) this.probed = probed;
  }

  detach(): void {
    if (this.ended) return;
    this.stop();
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }

  swap(): void {
    if (this.ended) return;
    this.close('detached');
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }

  get needsCpu(): boolean {
    return !this.ended && (!this.asking || !this.silent);
  }

  suspend(): void {
    this.budget.suspend();
  }

  sample(cpu: RendererCpu | null): void {
    const probed = this.probed;
    if (this.ended || probed === null) return;
    if (this.asking) {
      if (!this.silent && this.budget.sample(cpu, probed.share())) {
        this.silent = true;
        probed.report(false);
      }
      return;
    }
    if (probed.share() === 0 || cpu === null) return;
    this.asking = true;
    this.silent = false;
    this.budget.start(cpu);
    const process = this.contents.mainFrame.processId;
    const pid = this.contents.getOSProcessId();
    const answered = () => {
      this.asking = false;
      if (
        this.ended ||
        this.contents.isDestroyed() ||
        this.contents.mainFrame.processId !== process ||
        this.contents.getOSProcessId() !== pid
      )
        return;
      this.silent = false;
      probed.report(true);
    };
    this.contents.debugger.sendCommand('Runtime.evaluate', { expression: '0', returnByValue: true }).then(answered, (error: unknown) => {
      this.asking = false;
      if (!this.ended) console.debug(`[tagma-desktop] a renderer probe was not answered: ${String(error)}`);
    });
  }

  private close(end: SessionEnd): void {
    if (this.ended) return;
    this.stop();
    this.reporter.ended(this.session, end);
  }

  private stop(): void {
    this.ended = true;
    this.probed = null;
    if (!this.contents.isDestroyed()) {
      this.contents.debugger.off('message', this.message);
      this.contents.debugger.off('detach', this.detached);
    }
    this.gone(this);
  }
}
