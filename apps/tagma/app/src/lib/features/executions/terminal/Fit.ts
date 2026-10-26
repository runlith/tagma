import type { Engine } from './terminalEngine.js';

export interface FitGrid {
  readonly cols: number;
  readonly rows: number;
}

export interface FitFrames {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface FitObservation {
  observe(element: Element): void;
  disconnect(): void;
}

export interface FitReport {
  measured(box: FitGrid): void;
}

const MIN_FIT_WIDTH_PX = 48;
const MIN_FIT_HEIGHT_PX = 24;
const MIN_FIT_COLS = 8;
const MIN_FIT_ROWS = 4;
const STABLE_FIT_FRAMES = 8;

export class TerminalFit {
  private host: Element | null = null;
  private observation: FitObservation | null = null;
  private initialFrame: number | null = null;
  private stableFrame: number | null = null;
  private holdDepth = 0;
  private heldBox: FitGrid | null = null;
  private rebuildHold = 0;
  private rebuildQueued = false;

  constructor(
    private readonly engine: Engine,
    private readonly frames: FitFrames,
    private readonly observeResize: (callback: () => void) => FitObservation,
    private readonly applyParked: () => void,
    private readonly report: FitReport,
  ) {}

  attach(host: Element): void {
    this.detach();
    this.host = host;
    this.observation = this.observeResize(() => this.requestFit());
    this.observation.observe(host);
    this.initialFrame = this.frames.requestFrame(() => {
      this.initialFrame = null;
      this.fitNow();
    });
  }

  detach(): void {
    this.host = null;
    this.observation?.disconnect();
    this.observation = null;
    this.cancelFrame(this.initialFrame);
    this.initialFrame = null;
    this.cancelFrame(this.stableFrame);
    this.stableFrame = null;
    this.holdDepth = 0;
    this.heldBox = null;
    this.rebuildHold = 0;
    this.rebuildQueued = false;
  }

  requestFit(): void {
    if (this.rebuildHold > 0) {
      this.rebuildQueued = true;
      return;
    }
    const host = this.host;
    if (!host || this.stableFrame !== null) return;
    if (!visibleBox(host)) return;
    let previous = this.propose();
    let count = 0;
    const step = (): void => {
      this.stableFrame = null;
      if (this.host !== host || !visibleBox(host)) return;
      const next = this.propose();
      count += 1;
      if (!next || gridsEqual(next, this.grid()) || gridsEqual(previous, next) || count >= STABLE_FIT_FRAMES) {
        this.fitNow();
        return;
      }
      previous = next;
      this.stableFrame = this.frames.requestFrame(step);
    };
    this.stableFrame = this.frames.requestFrame(step);
  }

  reveal(): void {
    const host = this.host;
    if (!host) return;
    if (hasPixelBox(host)) this.applyParked();
    this.fitNow();
  }

  hold(): () => void {
    this.holdDepth += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holdDepth = Math.max(0, this.holdDepth - 1);
      if (this.holdDepth > 0) return;
      const box = this.heldBox;
      this.heldBox = null;
      if (box && this.host) this.report.measured(box);
    };
  }

  holdForRebuild(): () => void {
    this.rebuildHold += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.rebuildHold = Math.max(0, this.rebuildHold - 1);
      if (this.rebuildHold > 0) return;
      if (!this.rebuildQueued) return;
      this.rebuildQueued = false;
      if (this.host) this.requestFit();
    };
  }

  private fitNow(): void {
    if (!this.host || !this.measurable()) return;
    this.applyParked();
    if (!this.measurable()) return;
    const proposal = this.propose();
    if (proposal !== null) this.tell(proposal);
  }

  private tell(box: FitGrid): void {
    if (this.holdDepth > 0) {
      this.heldBox = box;
      return;
    }
    this.report.measured(box);
  }

  private measurable(): boolean {
    const host = this.host;
    if (!host || !hasPixelBox(host)) return false;
    const dims = this.propose();
    if (!dims) return false;
    return dims.cols >= MIN_FIT_COLS && dims.rows >= MIN_FIT_ROWS;
  }

  private grid(): FitGrid {
    return { cols: this.engine.terminal.cols, rows: this.engine.terminal.rows };
  }

  private propose(): FitGrid | null {
    try {
      const dims = this.engine.fit.proposeDimensions();
      return dims ? { cols: dims.cols, rows: dims.rows } : null;
    } catch {
      return null;
    }
  }

  private cancelFrame(handle: number | null): void {
    if (handle !== null) this.frames.cancelFrame(handle);
  }
}

function gridsEqual(a: FitGrid | null | undefined, b: FitGrid | null | undefined): boolean {
  return !!a && !!b && a.cols === b.cols && a.rows === b.rows;
}

function clientSize(host: Element): { width: number; height: number } | null {
  try {
    const rect = host.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  } catch {
    return null;
  }
}

function hasPixelBox(host: Element): boolean {
  const box = clientSize(host);
  return !!box && box.width >= MIN_FIT_WIDTH_PX && box.height >= MIN_FIT_HEIGHT_PX;
}

function visibleBox(host: Element): boolean {
  const box = clientSize(host);
  return !!box && box.width > 0 && box.height > 0;
}
