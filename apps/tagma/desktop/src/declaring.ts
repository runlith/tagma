import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import { app, type WebContents, webContents } from 'electron';
import type { Declarations } from './browser/connection.js';
import { creationPrecisionMs, declared, type Frame, type Hosted, type Role } from './declared.js';

const SETTLE_MS = 100;
const RECHECK_MS = 5_000;

export type DeclaringPages = {
  readonly pageOf: (contents: WebContents) => PageId | null;
  readonly observe: (listener: () => void) => void;
};

const framesOf = (contents: WebContents): readonly Frame[] => {
  if (contents.isDestroyed()) return [];
  const root = contents.mainFrame;
  if (root.isDestroyed()) return [];
  return root.framesInSubtree
    .filter((frame) => !frame.isDestroyed())
    .map((frame) => ({ pid: frame.osProcessId, origin: frame.origin, main: frame.parent === null }));
};

export class Declaring {
  private reporter: Declarations | null = null;
  private settling: ReturnType<typeof setTimeout> | null = null;
  private rechecking: ReturnType<typeof setInterval> | null = null;
  private sent = '';

  constructor(
    private readonly pages: DeclaringPages,
    private readonly trusted: (url: string) => boolean,
  ) {}

  install(): void {
    app.on('web-contents-created', (_event, contents) => {
      const moved = () => this.moved();
      contents.on('did-frame-navigate', moved);
      contents.on('did-navigate', moved);
      contents.on('frame-created', moved);
      contents.on('render-process-gone', moved);
      contents.on('destroyed', moved);
    });
    app.on('child-process-gone', () => this.moved());
    this.pages.observe(() => this.moved());
  }

  attach(reporter: Declarations): void {
    this.detach();
    this.reporter = reporter;
    this.sent = '';
    this.send();
    this.rechecking = setInterval(() => this.moved(), RECHECK_MS);
  }

  detach(): void {
    this.reporter = null;
    if (this.settling !== null) clearTimeout(this.settling);
    if (this.rechecking !== null) clearInterval(this.rechecking);
    this.settling = null;
    this.rechecking = null;
  }

  private moved(): void {
    if (this.reporter === null || this.settling !== null) return;
    this.settling = setTimeout(() => {
      this.settling = null;
      this.send();
    }, SETTLE_MS);
  }

  private send(): void {
    if (this.reporter === null) return;
    const hosted = webContents
      .getAllWebContents()
      .filter((contents) => !contents.isDestroyed())
      .map((contents): Hosted => {
        const page = this.pages.pageOf(contents);
        const role: Role =
          page !== null ? { kind: 'page', page } : this.trusted(contents.getURL()) ? { kind: 'interface' } : { kind: 'other' };
        return { role, frames: framesOf(contents) };
      });
    const declaration = declared(app.getAppMetrics(), hosted, creationPrecisionMs(process.platform));
    const text = JSON.stringify(declaration);
    if (text === this.sent) return;
    this.sent = text;
    this.reporter.declare(declaration);
  }
}
