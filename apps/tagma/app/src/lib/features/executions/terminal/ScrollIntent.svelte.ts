import type { IDisposable, IMarker, Terminal } from '@xterm/xterm';
import type { Engine } from './terminalEngine.js';

export type ScrollIntentKind = 'followOutput' | 'pinnedViewport';

export interface ScrollIntent {
  readonly kind: ScrollIntentKind;
  readonly bufferType: 'normal' | 'alternate';
  readonly viewportY: number;
  readonly baseY: number;
  readonly revision: number;
}

interface Anchor {
  readonly row: IMarker;
  readonly logical: IMarker | null;
  readonly cellOffset: number | null;
}

export interface ScrollCapture {
  readonly intent: ScrollIntent;
  readonly anchor: Anchor | null;
}

export interface ScrollIntentOptions {
  readonly now?: () => number;
  readonly delay?: (step: () => void, ms: number) => () => void;
  readonly frame?: (step: () => void) => () => void;
  readonly onProblem?: (problem: string) => void;
}

export class ScrollIntentStore {
  private intent: ScrollIntent | null = null;
  private holder: symbol | null = null;

  get(): ScrollIntent | null {
    return this.intent;
  }

  set(intent: ScrollIntent): void {
    this.intent = intent;
  }

  claim(): symbol {
    const token = Symbol('scroll-intent');
    this.holder = token;
    return token;
  }

  holds(token: symbol): boolean {
    return this.holder === token;
  }
}

const SETTLE_MS = 80;
const LAYOUT_RESTORE_MS = 80;
const REPARENT_RESTORE_MS = 200;
const REDRAW_QUIET_MS = 120;
const REDRAW_CAP_MS = 1_000;
const RESTORE_FRAMES = 2;
const ERASE_SCROLLBACK = 3;

export class TerminalScrollIntent {
  private record: ScrollIntent = $state.raw({
    kind: 'followOutput',
    bufferType: 'normal',
    viewportY: 0,
    baseY: 0,
    revision: 0,
  });
  private readonly token: symbol;
  private readonly now: () => number;
  private readonly delay: (step: () => void, ms: number) => () => void;
  private readonly frame: (step: () => void) => () => void;
  private readonly reportProblem: (problem: string) => void;
  private readonly reportedScroll = new Set<string>();
  private readonly listeners: IDisposable[] = [];
  private readonly pending = new Set<{ cancel: () => void }>();
  private readonly following = new Set<() => void>();
  private readonly held = new Map<string, () => void>();
  private revision = 0;
  private detach: (() => void) | null = null;
  private rebuilding = 0;
  private disposed = false;
  private deferred: Deferred | null = null;
  private erase: PendingErase | null = null;
  private gestureDuringRebuild: Gesture | null = null;
  private pointerScroll = false;
  private userInput = false;

  constructor(
    private readonly engine: Engine,
    private readonly store: ScrollIntentStore,
    options: ScrollIntentOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.delay =
      options.delay ??
      ((step, ms) => {
        const timer = setTimeout(step, ms);
        return () => clearTimeout(timer);
      });
    this.frame =
      options.frame ??
      ((step) => {
        const id = requestAnimationFrame(step);
        return () => cancelAnimationFrame(id);
      });
    this.reportProblem = options.onProblem ?? (() => undefined);

    this.token = store.claim();
    const kept = store.get();
    this.revision = kept?.revision ?? 0;
    this.record = kept ?? this.sampled();
    store.set(this.record);

    this.watchGestures();
    this.watchScrollbackErase();
  }

  get kind(): ScrollIntentKind {
    return this.record.kind;
  }

  capture(): ScrollCapture | null {
    const intent = this.current();
    if (!intent) return null;
    return { intent, anchor: intent.kind === 'pinnedViewport' ? this.anchor() : null };
  }

  restore(capture: ScrollCapture | null): void {
    if (!capture) return;
    this.cancelDeferred();
    if (this.paint(capture, this.by(capture.intent)) !== 'retry') {
      releaseAnchor(capture);
      return;
    }
    let left = RESTORE_FRAMES;
    const deferred = this.defer(capture);
    const retry = (): void => {
      if (this.deferred !== deferred) return;
      left -= 1;
      if (this.paint(capture, this.by(capture.intent)) === 'retry' && left > 0) {
        deferred.cancels.push(this.frame(retry));
        return;
      }
      this.cancelDeferred();
    };
    deferred.cancels.push(this.frame(retry));
  }

  restoreAfterLayout(capture: ScrollCapture | null): void {
    if (!capture) return;
    this.cancelDeferred();
    this.paint(capture, this.by(capture.intent));
    const deferred = this.defer(capture);
    deferred.cancels.push(
      this.frame(() => {
        if (this.deferred !== deferred) return;
        this.paint(capture, this.by(capture.intent));
        deferred.cancels.push(
          this.frame(() => {
            if (this.deferred === deferred) this.paint(capture, this.by(capture.intent));
          }),
        );
      }),
    );
    deferred.cancels.push(
      this.delay(() => {
        if (this.deferred !== deferred) return;
        this.paint(capture, this.by(capture.intent));
        this.cancelDeferred();
      }, LAYOUT_RESTORE_MS),
    );
  }

  restoreAfterReparent(capture: ScrollCapture | null): void {
    if (!capture) return;
    this.cancelDeferred();
    const deferred = this.defer(capture);
    deferred.cancels.push(
      this.frame(() => {
        if (this.deferred !== deferred) return;
        deferred.cancels.push(
          this.frame(() => {
            if (this.deferred !== deferred || this.onAlternate(capture)) return;
            this.paint(capture, this.by(capture.intent));
            this.repaint();
          }),
        );
      }),
    );
    deferred.cancels.push(
      this.delay(() => {
        if (this.deferred !== deferred) return;
        if (capture.intent.bufferType === 'alternate') {
          this.cancelDeferred();
          return;
        }
        if (this.engine.terminal.buffer.active.type === 'alternate') {
          this.settleWhenNormal(deferred, capture);
          return;
        }
        this.paint(capture, this.by(capture.intent));
        this.repaint();
        this.cancelDeferred();
      }, REPARENT_RESTORE_MS),
    );
  }

  enforce(): void {
    const stored = this.record;
    const intent = stored.kind === 'pinnedViewport' && atBottom(stored) ? { ...stored, kind: 'followOutput' as const } : stored;
    this.paint({ intent, anchor: null }, this.by(intent));
  }

  jump(edge: 'top' | 'bottom'): void {
    const terminal = this.engine.terminal;
    this.write(edge === 'top' ? 'pinnedViewport' : 'followOutput');
    if (edge === 'top') terminal.scrollToTop();
    else terminal.scrollToBottom();
    this.sample({ allowShrink: true, holdPin: edge === 'top' });
  }

  clear(): void {
    this.engine.terminal.clear();
    this.engine.terminal.scrollToBottom();
    this.write('followOutput');
  }

  async bracketRebuild(paint: () => void | Promise<void>): Promise<void> {
    const capture = this.capture();
    this.cancelDeferred();
    this.rebuilding += 1;
    try {
      await paint();
    } finally {
      this.rebuilding -= 1;
      if (this.rebuilding === 0 && !this.disposed) this.afterRebuild(capture);
      else releaseAnchor(capture);
    }
  }

  deferDuringRebuild(key: string, mutation: () => void): boolean {
    if (this.rebuilding === 0 || this.disposed) return false;
    this.held.set(key, mutation);
    return true;
  }

  whenFollowing(listener: () => void): () => void {
    if (this.record.kind === 'followOutput') {
      listener();
      return () => undefined;
    }
    this.following.add(listener);
    return () => {
      this.following.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.store.holds(this.token)) this.sample({ allowShrink: false });
    this.disposed = true;
    this.cancelDeferred();
    this.disarmErase();
    this.held.clear();
    this.following.clear();
    for (const entry of this.pending) entry.cancel();
    this.pending.clear();
    this.detach?.();
    this.detach = null;
    for (const listener of this.listeners.splice(0)) listener.dispose();
  }

  private sampled(): ScrollIntent {
    const live = position(this.engine.terminal);
    return { ...live, kind: atBottom(live) ? 'followOutput' : 'pinnedViewport', revision: (this.revision += 1) };
  }

  private write(kind: ScrollIntentKind, at: Position = position(this.engine.terminal)): void {
    this.latch({ ...at, kind, revision: (this.revision += 1) });
  }

  private latch(intent: ScrollIntent): void {
    this.record = intent;
    if (this.store.holds(this.token)) this.store.set(intent);
    if (intent.kind !== 'followOutput' || this.following.size === 0) return;
    const waiting = [...this.following];
    this.following.clear();
    for (const listener of waiting) listener();
  }

  private sample(options: { allowShrink: boolean; holdPin?: boolean }): void {
    if (this.rebuilding > 0 || this.disposed) return;
    const live = position(this.engine.terminal);
    const stored = this.record;
    if (!options.allowShrink && stored.kind === 'pinnedViewport' && live.baseY < stored.baseY) return;
    if (options.holdPin && stored.kind === 'pinnedViewport' && atBottom(live)) return;
    const kind = atBottom(live) ? 'followOutput' : 'pinnedViewport';
    if (stored.kind === kind && stored.bufferType === live.bufferType && (kind === 'followOutput' || stored.viewportY === live.viewportY)) {
      if (kind === 'pinnedViewport' && stored.baseY !== live.baseY) this.latch({ ...stored, baseY: live.baseY });
      return;
    }
    this.write(kind, live);
  }

  private current(): ScrollIntent | null {
    if (this.rebuilding > 0 || this.disposed) return null;
    const live = position(this.engine.terminal);
    const stored = this.record;
    let kind = stored.kind;
    if (kind === 'pinnedViewport' && atBottom(live) && live.baseY >= stored.baseY) kind = 'followOutput';
    const at = stored.kind === 'pinnedViewport' && live.baseY < stored.baseY ? stored : live;
    return { ...at, kind, revision: stored.revision };
  }

  private anchor(): Anchor | null {
    const terminal = this.engine.terminal;
    const buffer = terminal.buffer.active;
    if (buffer.type !== 'normal' || buffer.viewportY >= buffer.baseY) return null;
    const cursor = buffer.baseY + buffer.cursorY;
    const row = terminal.registerMarker(buffer.viewportY - cursor);
    const logical = logicalAnchor(terminal, buffer.viewportY);
    if (!logical) return { row, logical: null, cellOffset: null };
    return {
      row,
      logical: logical.lineY === buffer.viewportY ? row : terminal.registerMarker(logical.lineY - cursor),
      cellOffset: logical.cellOffset,
    };
  }

  private paint(capture: ScrollCapture, by: RestoreBy): 'restored' | 'retry' | 'skipped' {
    const terminal = this.engine.terminal;
    const { intent, anchor } = capture;
    if (this.rebuilding > 0 || this.disposed) return 'skipped';
    if (this.record.revision !== intent.revision) return 'skipped';
    if (!terminal.element) return 'retry';
    const live = position(terminal);
    if (intent.bufferType === 'alternate' || live.bufferType !== intent.bufferType) return 'skipped';
    if (intent.kind === 'followOutput') {
      if (!this.reached('follow-output', () => terminal.scrollToBottom())) return 'retry';
      this.latch({ ...intent, ...position(terminal), kind: 'followOutput' });
      return 'restored';
    }
    const target = clamp(this.line(intent, anchor, by, live), live.baseY);
    if (live.viewportY !== target && !this.reached('pinned-viewport', () => terminal.scrollToLine(target))) return 'retry';
    this.jiggle(terminal);
    const after = position(terminal);
    if (after.baseY < intent.baseY) return 'restored';
    this.latch({ ...intent, ...after, kind: 'pinnedViewport' });
    return 'restored';
  }

  private reached(context: string, scroll: () => void): boolean {
    try {
      scroll();
      return true;
    } catch {
      if (!this.reportedScroll.has(context)) {
        this.reportedScroll.add(context);
        this.reportProblem(`scrolling the terminal (${context}) failed and will be retried`);
      }
      return false;
    }
  }

  private jiggle(terminal: Terminal): void {
    const buffer = terminal.buffer.active;
    if (buffer.viewportY >= buffer.baseY) return;
    const first = buffer.viewportY > 0 ? -1 : 1;
    this.reached('scrollbar-sync', () => terminal.scrollLines(first));
    this.reached('scrollbar-sync', () => terminal.scrollLines(-first));
  }

  private line(intent: ScrollIntent, anchor: Anchor | null, by: RestoreBy, live: Position): number {
    if (anchor) {
      const { cellOffset, logical, row } = anchor;
      if (logical && !logical.isDisposed && cellOffset !== null) {
        return resolveLine(this.engine.terminal, logical.line, cellOffset);
      }
      if (!row.isDisposed) return row.line;
    }
    return by === 'bottomOffset' ? live.baseY - Math.max(0, intent.baseY - intent.viewportY) : intent.viewportY;
  }

  private by(intent: ScrollIntent): RestoreBy {
    return position(this.engine.terminal).baseY < intent.baseY ? 'bottomOffset' : 'line';
  }

  private defer(capture: ScrollCapture): Deferred {
    const deferred: Deferred = { capture, cancels: [] };
    this.deferred = deferred;
    return deferred;
  }

  private cancelDeferred(): void {
    const deferred = this.deferred;
    if (!deferred) return;
    this.deferred = null;
    for (const cancel of deferred.cancels) cancel();
    releaseAnchor(deferred.capture);
  }

  private onAlternate(capture: ScrollCapture): boolean {
    return capture.intent.bufferType === 'alternate' || this.engine.terminal.buffer.active.type === 'alternate';
  }

  private settleWhenNormal(deferred: Deferred, capture: ScrollCapture): void {
    const watch = this.engine.terminal.buffer.onBufferChange((buffer) => {
      if (buffer.type === 'alternate' || this.deferred !== deferred) return;
      watch.dispose();
      this.paint(capture, this.by(capture.intent));
      this.repaint();
      this.cancelDeferred();
    });
    deferred.cancels.push(() => watch.dispose());
  }

  private repaint(): void {
    const terminal = this.engine.terminal;
    try {
      terminal.refresh(0, terminal.rows - 1);
    } catch {}
  }

  private afterRebuild(capture: ScrollCapture | null): void {
    if (capture) {
      this.paint(capture, 'bottomOffset');
      releaseAnchor(capture);
    }
    const gesture = this.gestureDuringRebuild;
    this.gestureDuringRebuild = null;
    if (gesture) this.applyGesture(gesture);
    this.runHeld();
  }

  private runHeld(): void {
    if (this.held.size === 0) return;
    const held = new Map(this.held);
    this.held.clear();
    queueMicrotask(() => {
      for (const [key, mutation] of held) {
        if (this.disposed) return;
        if (this.rebuilding > 0) this.held.set(key, mutation);
        else mutation();
      }
    });
  }

  private watchGestures(): void {
    const terminal = this.engine.terminal;
    const signal = coreUserInput(terminal);

    this.listeners.push(
      terminal.onData((bytes) => {
        if (isMouseReport(bytes)) {
          this.userInput = false;
          if (this.record.kind === 'pinnedViewport') this.enforce();
          return;
        }
        if (signal && !this.userInput) return;
        this.userInput = false;
        this.applyGesture({ mode: 'sample' });
      }),
    );
    if (signal) this.listeners.push(signal(() => (this.userInput = true)));

    const host = terminal.element;
    if (!host) return;
    const onWheel = (event: WheelEvent): void => {
      const up = event.deltaY < 0;
      if (!this.applyGesture({ mode: up ? 'holdPin' : 'sample' })) return;
      if (up) this.write('pinnedViewport');
      this.settle(up);
    };
    const onPointerDown = (event: PointerEvent): void => {
      this.pointerScroll = isScrollbarTarget(event.target);
    };
    const onPointerDone = (): void => {
      if (!this.pointerScroll) return;
      this.pointerScroll = false;
      this.applyGesture({ mode: 'holdPin' });
    };
    const onScroll = (): void => {
      if (this.pointerScroll) this.applyGesture({ mode: 'holdPin' });
    };
    host.addEventListener('wheel', onWheel, { capture: true, passive: true });
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('scroll', onScroll, true);
    globalThis.addEventListener('pointerup', onPointerDone, true);
    globalThis.addEventListener('pointercancel', onPointerDone, true);
    this.detach = () => {
      host.removeEventListener('wheel', onWheel, true);
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('scroll', onScroll, true);
      globalThis.removeEventListener('pointerup', onPointerDone, true);
      globalThis.removeEventListener('pointercancel', onPointerDone, true);
    };
  }

  private applyGesture(gesture: Gesture): boolean {
    if (this.rebuilding > 0) {
      this.gestureDuringRebuild = gesture;
      return false;
    }
    this.sample({ allowShrink: true, holdPin: gesture.mode === 'holdPin' });
    return true;
  }

  private settle(holdPin: boolean): void {
    const sample = (): void => this.sample({ allowShrink: true, holdPin });
    queueMicrotask(() => {
      if (!this.disposed) sample();
    });
    this.after(null, sample);
    this.after(null, () => this.after(null, sample));
    this.after(SETTLE_MS, () => this.sample({ allowShrink: true }));
  }

  private after(ms: number | null, step: () => void): void {
    const entry = { cancel: (): void => undefined };
    this.pending.add(entry);
    const run = (): void => {
      this.pending.delete(entry);
      if (!this.disposed) step();
    };
    entry.cancel = ms === null ? this.frame(run) : this.delay(run, ms);
  }

  private watchScrollbackErase(): void {
    const terminal = this.engine.terminal;
    const observe = (params: (number | number[])[]): boolean => this.observeErase(params);
    this.listeners.push(terminal.parser.registerCsiHandler({ final: 'J' }, observe));
    this.listeners.push(terminal.parser.registerCsiHandler({ prefix: '?', final: 'J' }, observe));
    this.listeners.push(
      terminal.onWriteParsed(() => {
        if (this.erase) this.armQuiet(this.erase);
      }),
    );
  }

  private observeErase(params: (number | number[])[]): boolean {
    if (params[0] !== ERASE_SCROLLBACK) return false;
    const live = position(this.engine.terminal);
    if (live.bufferType !== 'normal' || atBottom(live)) return false;
    const armed = this.erase;
    if (armed && this.record.revision === armed.capture.intent.revision) {
      this.armQuiet(armed);
      return false;
    }
    const current = this.current();
    if (!current || current.kind !== 'pinnedViewport') return false;
    this.disarmErase();
    const active: PendingErase = {
      capture: { intent: { ...live, kind: 'pinnedViewport', revision: current.revision }, anchor: null },
      bottomOffset: live.baseY - live.viewportY,
      deadline: this.now() + REDRAW_CAP_MS,
      cancel: () => undefined,
    };
    this.erase = active;
    this.armQuiet(active);
    return false;
  }

  private armQuiet(active: PendingErase): void {
    active.cancel();
    const quiet = Math.max(0, Math.min(REDRAW_QUIET_MS, active.deadline - this.now()));
    active.cancel = this.delay(() => this.applyErase(active), quiet);
  }

  private applyErase(active: PendingErase): void {
    if (this.erase !== active || this.disposed) return;
    const live = position(this.engine.terminal);
    if (this.record.revision !== active.capture.intent.revision || live.bufferType !== 'normal') {
      this.disarmErase();
      return;
    }
    if (live.baseY < active.bottomOffset && this.now() < active.deadline) {
      this.armQuiet(active);
      return;
    }
    this.disarmErase();
    this.paint(active.capture, 'bottomOffset');
  }

  private disarmErase(): void {
    this.erase?.cancel();
    this.erase = null;
  }
}

type RestoreBy = 'line' | 'bottomOffset';
type Gesture = { readonly mode: 'sample' | 'holdPin' };

interface Deferred {
  readonly capture: ScrollCapture;
  readonly cancels: (() => void)[];
}

interface PendingErase {
  readonly capture: ScrollCapture;
  readonly bottomOffset: number;
  readonly deadline: number;
  cancel: () => void;
}

interface Position {
  readonly bufferType: 'normal' | 'alternate';
  readonly viewportY: number;
  readonly baseY: number;
}

export function blankViewport(rows: number): string {
  const viewportRows = Math.max(1, Math.floor(rows));
  return `\x1b[?6l\x1b[r\x1b[${viewportRows};1H${'\r\n'.repeat(viewportRows)}\x1b[H`;
}

export function paintsPrintableContent(payload: string): boolean {
  return stripSequences(payload).replace(CONTROL_CHARACTERS, '').trim().length > 0;
}

/* eslint-disable no-control-regex -- these patterns exist to match terminal control bytes. */
const OSC_SEQUENCE = /(?:\u001b\]|\u009d)[\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;
const STRING_SEQUENCE = /(?:\u001b[P_^X]|\u0090|\u0098|\u009e|\u009f)[\s\S]*?(?:\u001b\\|\u009c)/g;
const CSI_SEQUENCE = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const ESCAPE_SEQUENCE = /\u001b[ -/]*[0-~]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
/* eslint-enable no-control-regex */

const stripSequences = (value: string): string =>
  value.replace(OSC_SEQUENCE, '').replace(STRING_SEQUENCE, '').replace(CSI_SEQUENCE, '').replace(ESCAPE_SEQUENCE, '');

const position = (terminal: Terminal): Position => {
  const buffer = terminal.buffer.active;
  return { bufferType: buffer.type, viewportY: buffer.viewportY, baseY: buffer.baseY };
};

const atBottom = (at: { readonly viewportY: number; readonly baseY: number }): boolean => at.viewportY >= at.baseY;

const clamp = (line: number, baseY: number): number => Math.max(0, Math.min(line, baseY));

const releaseAnchor = (capture: ScrollCapture | null): void => {
  const anchor = capture?.anchor;
  if (!anchor) return;
  anchor.row.dispose();
  if (anchor.logical !== anchor.row) anchor.logical?.dispose();
};

function logicalAnchor(terminal: Terminal, viewportY: number): { lineY: number; cellOffset: number } | null {
  const buffer = terminal.buffer.active;
  let lineY = viewportY;
  while (lineY > 0 && (buffer.getLine(lineY)?.isWrapped ?? false)) lineY -= 1;
  if (terminal.options.reflowCursorLine !== true && holdsLine(terminal, lineY, buffer.baseY + buffer.cursorY)) {
    return null;
  }
  let cellOffset = 0;
  for (let row = lineY; row < viewportY; row += 1) cellOffset += rowCells(terminal, row);
  return { cellOffset, lineY };
}

function resolveLine(terminal: Terminal, logicalStartY: number, cellOffset: number): number {
  const buffer = terminal.buffer.active;
  let lineY = logicalStartY;
  let left = cellOffset;
  while (lineY < buffer.baseY && (buffer.getLine(lineY + 1)?.isWrapped ?? false)) {
    const cells = rowCells(terminal, lineY);
    if (left < cells) break;
    left -= cells;
    lineY += 1;
  }
  return lineY;
}

function holdsLine(terminal: Terminal, logicalStartY: number, targetY: number): boolean {
  const buffer = terminal.buffer.active;
  if (targetY < logicalStartY) return false;
  for (let lineY = logicalStartY + 1; lineY <= targetY; lineY += 1) {
    if (!(buffer.getLine(lineY)?.isWrapped ?? false)) return false;
  }
  return true;
}

function rowCells(terminal: Terminal, lineY: number): number {
  const cols = Math.max(terminal.cols, 1);
  const buffer = terminal.buffer.active;
  const last = buffer.getLine(lineY)?.getCell(cols - 1);
  const next = buffer.getLine(lineY + 1)?.getCell(0);
  return last?.getCode() === 0 && last.getWidth() === 1 && next?.getWidth() === 2 ? cols - 1 : cols;
}

function isMouseReport(data: string): boolean {
  return data.charCodeAt(0) === 0x1b && data.charAt(1) === '[' && (data.charAt(2) === '<' || data.charAt(2) === 'M');
}

function isScrollbarTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.xterm-viewport,.xterm-scrollbar,.xterm-slider') !== null;
}

function coreUserInput(terminal: Terminal): ((listener: () => void) => IDisposable) | null {
  const core = (terminal as Terminal & { _core?: { coreService?: { onUserInput?: unknown } } })._core;
  const signal = core?.coreService?.onUserInput;
  return typeof signal === 'function' ? (signal as (listener: () => void) => IDisposable) : null;
}
