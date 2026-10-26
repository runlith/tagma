import { offsetValue, type ByteOffset } from '@runlith/executions/protocol/record';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { TerminalRetention, type RetentionBuffer, type RetentionEngine } from './Retention.js';
import { markTerminalInput, type TerminalDeliveryRoad } from './terminalChainRecord.js';

export interface Time {
  now(): number;
  after(ms: number, run: () => void): () => void;
  frame(run: () => void): () => void;
  post(run: () => void): void;
}

export function pageTime(): Time {
  let channel: MessageChannel | null = null;
  const posted: (() => void)[] = [];
  return {
    now: () => performance.now(),
    after: (ms, run) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
    frame: (run) => {
      const id = requestAnimationFrame(run);
      return () => cancelAnimationFrame(id);
    },
    post: (run) => {
      if (channel === null) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => posted.shift()?.();
      }
      posted.push(run);
      channel.port2.postMessage(null);
    },
  };
}

export function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

export interface OutputTarget extends RetentionEngine {
  readonly buffer: { readonly active: RetentionBuffer & { readonly viewportY: number } };
  write(data: string, callback?: () => void): void;
  refresh(start: number, end: number): void;
  readonly _core?: { refresh?(start: number, end: number, sync?: boolean): void };
}

export interface PaneOutput {
  visible(): boolean;
  focused(): boolean;
  webgl(): boolean;
  scrollbackRows(): number;
  reread(from: ByteOffset): void;
  dead(): void;
  unavailable?: (message: string) => void;
  onBell?: () => void;
  onRetained?: () => void;
}

export interface Writer {
  write(bytes: Uint8Array, parsed: () => void, at?: ByteOffset): void;
  screen(bytes: Uint8Array, parsed: () => void): void;
  focus(visible: boolean): void;
  typed(): void;
  replaying(on: boolean): void;
  replayInFlight(): boolean;
  pending(): number;
  dispose(): void;
}

const BACKGROUND_FLUSH_DELAY_MS = 50;
const BACKGROUND_DRAIN_INTERVAL_MS = 16;
const CHUNK_CHARS = 16 * 1024;
const FRESH_ENGINE =
  '\u001bc\u001b[?25h\u001b[20l\u001b]104\u001b\\\u001b]110\u001b\\\u001b]111\u001b\\\u001b]112\u001b\\\u001b]2;\u001b\\';
const WRITES_PER_TICK = 2;
const HIGH_PRIORITY_WRITES_PER_TICK = 8;
const DRAIN_BUDGET_MS = 8;
const LARGE_BACKLOG_CHARS = 512 * 1024;
const MAX_QUEUE_CHUNKS = 4096;
const BACKLOG_MIN_CAP_CHARS = 2 * 1024 * 1024;
const BACKLOG_CHARS_PER_SCROLLBACK_ROW = 120;
const SCROLLBACK_ROWS_DEFAULT = 5_000;
const SCROLLBACK_ROWS_MIN = 1_000;
const SCROLLBACK_ROWS_MAX = 50_000;
export const HIDDEN_BACKLOG_WARNING = '\u0018\u001b[0m\r\n[Tagma skipped hidden terminal output because the backlog grew too large.]\r\n';
export const FOREGROUND_BACKLOG_WARNING =
  '\u0018\u001b[0m\r\n[Tagma skipped a burst of terminal output because the backlog grew too large.]\r\n';
const SYNC_FOREGROUND_FLUSH_CHARS = 256 * 1024;
const VISIBLE_RESUME_FLUSH_CHARS = 256 * 1024;
const FOREGROUND_IMMEDIATE_CHARS = 2048;
const FOREGROUND_INTERACTIVE_REDRAW_CHARS = 128 * 1024;
const FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS = 150;
const FOREGROUND_IMMEDIATE_BUDGET_CHARS = 128 * 1024;
const FOREGROUND_BUDGET_WINDOW_MS = 500;
const INACTIVE_FOREGROUND_IMMEDIATE_BUDGET_CHARS = 32 * 1024;
const STALL_CHECK_MS = 10_000;
const MAX_REPORTS_PER_CONTEXT = 5;
const FLOOD_SUPPRESS_MS = 2000;
const MAX_HELD_TAIL_CHARS = 4096;
const COMPACT_AT = 64;

const ESC = '\u001b';
const CSI = `${ESC}[`;
const BEL = '\u0007';
const CAN = '\u0018';
const SUB = '\u001a';
const ST = '\\';
const OSC_INTRODUCER = ']';

interface Chunk {
  data: string;
  retained: number;
  foreground: boolean;
  forceRefresh: boolean;
  at: ByteOffset | null;
  done: (() => void)[];
}

interface Take {
  data: string;
  foreground: boolean;
  forceRefresh: boolean;
  done: (() => void)[];
}

interface Budget {
  chars: number;
  windowStart: number;
}

const once = (run: () => void): (() => void) => {
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    run();
  };
};

const drained = (): Chunk => ({ data: '', retained: 0, foreground: false, forceRefresh: false, at: null, done: [] });

const flatten = (value: string): string => (value.length === 0 ? value : `${value} `.slice(0, -1));

function consumeBudget(budget: Budget, now: number, length: number, cap: number): boolean {
  if (now - budget.windowStart >= FOREGROUND_BUDGET_WINDOW_MS) {
    budget.chars = 0;
    budget.windowStart = now;
  }
  if (budget.chars + length > cap) return false;
  budget.chars += length;
  return true;
}

function backlogCap(scrollbackRows: number): number {
  const rows = Number.isFinite(scrollbackRows)
    ? Math.min(SCROLLBACK_ROWS_MAX, Math.max(SCROLLBACK_ROWS_MIN, Math.floor(scrollbackRows)))
    : SCROLLBACK_ROWS_DEFAULT;
  return Math.max(BACKLOG_MIN_CAP_CHARS, rows * BACKLOG_CHARS_PER_SCROLLBACK_ROW);
}

type ScanState = 'ground' | 'esc' | 'escIntermediate' | 'csi' | 'osc' | 'oscEsc' | 'string' | 'stringEsc';

const ESC_CODE = 0x1b;
const CAN_CODE = 0x18;
const SUB_CODE = 0x1a;
const BEL_CODE = 0x07;

function stateAfterEsc(code: number): ScanState {
  if (code === 0x5b) return 'csi';
  if (code === 0x5d) return 'osc';
  if (code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f) return 'string';
  if (code >= 0x20 && code <= 0x2f) return 'escIntermediate';
  if (code < 0x20 || code === 0x7f) return 'esc';
  return 'ground';
}

function joinBytes(head: Uint8Array, rest: Uint8Array): Uint8Array {
  const joined = new Uint8Array(head.length + rest.length);
  joined.set(head);
  joined.set(rest, head.length);
  return joined;
}

function wholeUtf8(bytes: Uint8Array): number {
  for (let back = 1; back <= Math.min(4, bytes.length); back += 1) {
    const at = bytes.length - back;
    const byte = bytes[at] as number;
    if ((byte & 0xc0) === 0x80) continue;
    const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return back < width ? at : bytes.length;
  }
  return bytes.length;
}

export function incompleteControlTail(text: string): string {
  let state: ScanState = 'ground';
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (state === 'ground') {
      if (code === ESC_CODE) {
        start = index;
        state = 'esc';
      }
      continue;
    }
    if (code === ESC_CODE && state !== 'osc' && state !== 'string' && state !== 'oscEsc' && state !== 'stringEsc') {
      start = index;
      state = 'esc';
      continue;
    }
    if ((code === CAN_CODE || code === SUB_CODE) && (state === 'esc' || state === 'escIntermediate')) {
      state = 'ground';
      continue;
    }
    switch (state) {
      case 'esc':
        state = stateAfterEsc(code);
        break;
      case 'escIntermediate':
        if (code >= 0x30 && code <= 0x7e) state = 'ground';
        break;
      case 'csi':
        if (code === CAN_CODE || code === SUB_CODE || (code >= 0x40 && code <= 0x7e)) state = 'ground';
        break;
      case 'osc':
        if (code === BEL_CODE || code === CAN_CODE || code === SUB_CODE) state = 'ground';
        else if (code === ESC_CODE) state = 'oscEsc';
        break;
      case 'oscEsc':
        if (code === 0x5c) {
          state = 'ground';
        } else {
          start = index - 1;
          state = code === ESC_CODE ? 'esc' : stateAfterEsc(code);
        }
        break;
      case 'string':
        if (code === CAN_CODE || code === SUB_CODE) state = 'ground';
        else if (code === ESC_CODE) state = 'stringEsc';
        break;
      case 'stringEsc':
        if (code === 0x5c) {
          state = 'ground';
        } else {
          start = index - 1;
          state = code === ESC_CODE ? 'esc' : stateAfterEsc(code);
        }
        break;
    }
  }
  return state === 'ground' ? '' : text.slice(start);
}

export function containsBellText(text: string): boolean {
  if (!text.includes(BEL)) return false;
  let pendingEscape = false;
  let inOsc = false;
  let pendingOscEscape = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (inOsc) {
      if (char === CAN || char === SUB) {
        inOsc = false;
        pendingOscEscape = false;
        continue;
      }
      if (pendingOscEscape) {
        pendingOscEscape = char === ESC;
        if (char === ST) {
          inOsc = false;
          pendingOscEscape = false;
        }
        continue;
      }
      if (char === BEL) {
        inOsc = false;
        continue;
      }
      pendingOscEscape = char === ESC;
      continue;
    }
    if (pendingEscape) {
      if (char === CAN || char === SUB) {
        pendingEscape = false;
        continue;
      }
      pendingEscape = false;
      if (char === OSC_INTRODUCER) {
        inOsc = true;
        pendingOscEscape = false;
      } else if (char === ESC) {
        pendingEscape = true;
      } else if (char === BEL) {
        return true;
      }
      continue;
    }
    if (char === ESC) {
      pendingEscape = true;
      continue;
    }
    if (char === BEL) return true;
  }
  return false;
}

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const SGR_SEQUENCE = /\u001b\[([0-9:;]*)m/g;

const inRange = (value: number, start: number, end: number): boolean => value >= start && value <= end;

function isRendererRiskCodePoint(value: number): boolean {
  return (
    inRange(value, 0x0590, 0x08ff) ||
    value === 0x200d ||
    inRange(value, 0x1100, 0x11ff) ||
    inRange(value, 0x2e80, 0x9fff) ||
    inRange(value, 0xa960, 0xa97f) ||
    inRange(value, 0xac00, 0xd7ff) ||
    inRange(value, 0xd800, 0xdfff) ||
    inRange(value, 0xf900, 0xfaff) ||
    inRange(value, 0xfe10, 0xfe1f) ||
    inRange(value, 0xfe30, 0xfe4f) ||
    inRange(value, 0xfb1d, 0xfdff) ||
    inRange(value, 0xfe00, 0xfe0f) ||
    inRange(value, 0xfe70, 0xfeff) ||
    inRange(value, 0xff00, 0xffef) ||
    value === 0xfffd ||
    inRange(value, 0x10ec0, 0x10eff) ||
    inRange(value, 0x1e900, 0x1e95f) ||
    inRange(value, 0x20000, 0x2fa1f) ||
    inRange(value, 0x30000, 0x3134f) ||
    inRange(value, 0xe0100, 0xe01ef)
  );
}

function sgrCode(param: string | undefined): number | null {
  if (!param) return null;
  const value = Number.parseInt(param.split(':')[0] ?? '', 10);
  return Number.isFinite(value) ? value : null;
}

function sgrSetsBackground(params: string): boolean {
  const parts = params.split(';');
  for (let index = 0; index < parts.length; index += 1) {
    const value = sgrCode(parts[index]);
    if (value === null) continue;
    if (inRange(value, 40, 47) || inRange(value, 100, 107) || value === 48) return true;
    if (value === 38 && !parts[index]?.includes(':')) {
      const mode = sgrCode(parts[index + 1]);
      index += mode === 5 ? 2 : mode === 2 ? 4 : 1;
    }
  }
  return false;
}

function containsBackgroundSgr(text: string): boolean {
  SGR_SEQUENCE.lastIndex = 0;
  for (let match = SGR_SEQUENCE.exec(text); match; match = SGR_SEQUENCE.exec(text)) {
    if (sgrSetsBackground(match[1] ?? '')) return true;
  }
  return false;
}

function containsNonAscii(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 0x7f) return true;
  }
  return false;
}

export function outputPrefersRefresh(text: string): boolean {
  if (containsBackgroundSgr(text)) return true;
  if (!containsNonAscii(text)) return false;
  if (EMOJI_PRESENTATION.test(text)) return true;
  for (let index = 0; index < text.length; index++) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) continue;
    if (isRendererRiskCodePoint(codePoint)) return true;
    if (codePoint > 0xffff) index += 1;
  }
  return false;
}

function containsStandaloneCarriageReturn(text: string): boolean {
  let index = text.indexOf('\r');
  while (index !== -1) {
    if (index === text.length - 1) return false;
    if (text[index + 1] !== '\n') return true;
    index = text.indexOf('\r', index + 1);
  }
  return false;
}

function containsEraseSequence(text: string): boolean {
  let escape = text.indexOf(CSI);
  while (escape !== -1) {
    for (let index = escape + 2; index < text.length; index++) {
      const char = text[index] ?? '';
      if ((char >= '0' && char <= '9') || char === ';' || char === '?') continue;
      if (char === 'J' || char === 'K') return true;
      break;
    }
    escape = text.indexOf(CSI, escape + 2);
  }
  return false;
}

export function rewritePrefersRefresh(text: string): boolean {
  return text.includes('\b') || containsStandaloneCarriageReturn(text) || containsEraseSequence(text);
}

type StallMode = 'completion' | 'probe';

interface StallWatch {
  cancel: () => void;
  mode: StallMode;
}

class Entry implements Writer {
  chunks: Chunk[] = [];
  head = 0;
  queuedChars = 0;
  highPriority = false;
  disposed = false;
  dead = false;
  unavailable = false;

  private readonly inFlight = new Set<() => void>();
  private stall: StallWatch | null = null;
  private parseGeneration = 0;
  private settle: (() => void) | null = null;
  private settleBefore: { baseY: number; viewportY: number } | null = null;

  private readonly decoder = new TextDecoder();
  private undecoded: Uint8Array = new Uint8Array(0);
  private heldTail = '';
  private endsWithCarriageReturn = false;

  private readonly budget: Budget = { chars: 0, windowStart: 0 };
  private lastTypedAt = Number.NEGATIVE_INFINITY;

  private replayMode = false;
  private replayPending = 0;

  private rereadFrom: ByteOffset | null = null;
  private suppressedUntil = Number.NEGATIVE_INFINITY;
  private floodRepaint: (() => void) | null = null;

  constructor(
    private readonly scheduler: TerminalOutput,
    private readonly time: Time,
    readonly target: OutputTarget,
    private readonly pane: PaneOutput,
    private readonly retention: TerminalRetention,
  ) {}

  write(bytes: Uint8Array, parsed: () => void, at?: ByteOffset): void {
    const credit = once(parsed);
    if (this.disposed || this.dead || this.unavailable) {
      credit();
      return;
    }
    const text = this.decode(bytes);
    const foreground = this.pane.visible();
    if (foreground && this.restore()) {
      credit();
      return;
    }
    if (text === '') {
      credit();
      return;
    }
    if (containsBellText(text)) this.scheduler.guard('bell-notify', () => this.pane.onBell?.());
    const done = [credit];
    if (this.replayMode) {
      this.replayPending += 1;
      done.push(
        once(() => {
          this.replayPending -= 1;
        }),
      );
    }
    if (foreground) this.writeForeground(text, bytes.length, done, at ?? null);
    else this.writeBackground(text, bytes.length, done, at ?? null);
  }

  screen(bytes: Uint8Array, parsed: () => void): void {
    const credit = once(parsed);
    if (this.disposed || this.dead || this.unavailable) {
      credit();
      return;
    }
    this.discardQueue();
    this.rereadFrom = null;
    this.resetDecoder();
    const done = [credit];
    if (this.replayMode) {
      this.replayPending += 1;
      done.push(
        once(() => {
          this.replayPending -= 1;
        }),
      );
    }
    this.armStall();
    this.writeInline({ data: FRESH_ENGINE + new TextDecoder().decode(bytes), foreground: true, forceRefresh: true, done }, false);
  }

  focus(visible: boolean): void {
    if (!visible) return;
    this.restore();
    this.flush(VISIBLE_RESUME_FLUSH_CHARS);
  }

  typed(): void {
    this.lastTypedAt = this.time.now();
    this.requestProbe();
  }

  replaying(on: boolean): void {
    this.replayMode = on;
    if (on) this.resetDecoder();
  }

  replayInFlight(): boolean {
    return this.replayPending > 0;
  }

  pending(): number {
    return this.undecoded.length + (this.heldTail === '' ? 0 : new TextEncoder().encode(this.heldTail).length);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.discardAll();
    this.cancelFloodRepaint();
    this.retention.dispose();
    this.scheduler.forget(this);
  }

  private writeForeground(text: string, byteSize: number, done: (() => void)[], at: ByteOffset | null): void {
    const replay = this.replayMode;
    const forceRefresh = replay || this.prefersRefresh(text);
    const echo = !replay && this.latencySensitive(text);
    if (!echo) {
      this.highPriority = true;
      this.enqueue(text, true, forceRefresh, at, done);
      this.capBacklog(FOREGROUND_BACKLOG_WARNING);
      this.scheduler.scheduleDrain(0);
      this.hop('delivered', 'queued', byteSize);
      return;
    }
    this.flush(SYNC_FOREGROUND_FLUSH_CHARS);
    if (this.dead) {
      for (const release of done) release();
      return;
    }
    this.armStall();
    this.hop('delivered', 'inline', byteSize);
    this.writeInline({ data: text, foreground: true, forceRefresh, done }, false);
  }

  private writeBackground(text: string, byteSize: number, done: (() => void)[], at: ByteOffset | null): void {
    this.enqueue(text, false, false, at, done);
    this.capBacklog(HIDDEN_BACKLOG_WARNING);
    this.scheduler.scheduleDrain(this.highPriority || this.queuedChars > LARGE_BACKLOG_CHARS ? 0 : BACKGROUND_FLUSH_DELAY_MS);
    this.hop('delivered', 'queued', byteSize);
  }

  private hop(stage: 'delivered' | 'parsed' | 'settled', road: TerminalDeliveryRoad | null, bytes: number | null): void {
    markTerminalInput({ stage, sequence: null, binding: null, road, bytes });
  }

  private latencySensitive(text: string): boolean {
    const now = this.time.now();
    if (!this.pane.focused()) {
      if (text.includes(CSI)) return false;
      return this.scheduler.consumeInactiveBudget(now, text.length);
    }
    if (text.length <= FOREGROUND_IMMEDIATE_CHARS) {
      return consumeBudget(this.budget, now, text.length, FOREGROUND_IMMEDIATE_BUDGET_CHARS);
    }
    const recentInput = now - this.lastTypedAt <= FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS;
    if (recentInput && text.length <= FOREGROUND_INTERACTIVE_REDRAW_CHARS && text.includes(CSI)) {
      return consumeBudget(this.budget, now, text.length, FOREGROUND_IMMEDIATE_BUDGET_CHARS);
    }
    return false;
  }

  private prefersRefresh(text: string): boolean {
    const rewrite = (this.endsWithCarriageReturn && text[0] !== '\n') || rewritePrefersRefresh(text);
    this.endsWithCarriageReturn = text.endsWith('\r');
    if (rewrite) return true;
    return (text.includes(CSI) || containsNonAscii(text)) && outputPrefersRefresh(text);
  }

  private decode(bytes: Uint8Array): string {
    const joined = this.undecoded.length === 0 ? bytes : joinBytes(this.undecoded, bytes);
    const whole = wholeUtf8(joined);
    this.undecoded = joined.slice(whole);
    const text = this.heldTail + this.decoder.decode(joined.subarray(0, whole));
    const tail = incompleteControlTail(text);
    this.heldTail = tail.length > MAX_HELD_TAIL_CHARS ? '' : tail;
    return this.heldTail === '' ? text : text.slice(0, text.length - this.heldTail.length);
  }

  private resetDecoder(): void {
    this.undecoded = new Uint8Array(0);
    this.heldTail = '';
    this.endsWithCarriageReturn = false;
  }

  hasQueued(): boolean {
    return this.head < this.chunks.length;
  }

  private enqueue(data: string, foreground: boolean, forceRefresh: boolean, at: ByteOffset | null, done: (() => void)[]): void {
    this.chunks.push({ data, retained: data.length, foreground, forceRefresh, at, done });
    this.queuedChars += data.length;
    this.scheduler.queue(this);
  }

  private take(limit: number): Take | null {
    let remaining = limit;
    const parts: string[] = [];
    let foreground: boolean | null = null;
    let forceRefresh = false;
    const done: (() => void)[] = [];
    while (remaining > 0 && this.head < this.chunks.length) {
      const chunk = this.chunks[this.head] as Chunk;
      if (foreground !== null && chunk.foreground !== foreground) break;
      foreground ??= chunk.foreground;
      forceRefresh ||= chunk.forceRefresh;
      if (chunk.data.length <= remaining) {
        parts.push(chunk.data);
        remaining -= chunk.data.length;
        this.queuedChars -= chunk.data.length;
        done.push(...chunk.done);
        this.chunks[this.head] = drained();
        this.head += 1;
        continue;
      }
      parts.push(chunk.data.slice(0, remaining));
      const residual = chunk.data.slice(remaining);
      const flat = residual.length * 2 <= chunk.retained;
      this.chunks[this.head] = { ...chunk, data: flat ? flatten(residual) : residual, retained: flat ? residual.length : chunk.retained };
      this.queuedChars -= remaining;
      remaining = 0;
    }
    this.compact();
    if (this.queuedChars < 0) this.queuedChars = 0;
    const data = parts.length === 1 ? (parts[0] as string) : parts.join('');
    return data === '' ? null : { data, foreground: foreground === true, forceRefresh, done };
  }

  private compact(): void {
    if (this.head === 0) return;
    if (this.head === this.chunks.length) {
      this.chunks.length = 0;
      this.head = 0;
      return;
    }
    if (this.head >= COMPACT_AT) {
      this.chunks.splice(0, this.head);
      this.head = 0;
    }
  }

  private capBacklog(warning: string): void {
    const cap = backlogCap(this.pane.scrollbackRows());
    if (this.queuedChars <= cap && this.chunks.length - this.head <= MAX_QUEUE_CHUNKS) return;
    for (let index = this.head; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index] as Chunk;
      if (chunk.at !== null && (this.rereadFrom === null || offsetValue(chunk.at) < offsetValue(this.rereadFrom))) {
        this.rereadFrom = chunk.at;
      }
      for (const release of chunk.done) release();
    }
    this.heldTail = '';
    this.chunks = [{ data: warning, retained: warning.length, foreground: false, forceRefresh: false, at: null, done: [] }];
    this.head = 0;
    this.queuedChars = warning.length;
    this.highPriority = true;
    this.noteDrop();
  }

  private noteDrop(): void {
    if (!this.pane.visible()) return;
    const now = this.time.now();
    this.suppressedUntil = now + FLOOD_SUPPRESS_MS;
    this.cancelFloodRepaint();
    this.floodRepaint = this.time.after(FLOOD_SUPPRESS_MS, () => {
      this.floodRepaint = null;
      this.restore();
    });
  }

  private cancelFloodRepaint(): void {
    this.floodRepaint?.();
    this.floodRepaint = null;
  }

  private restore(): boolean {
    if (this.rereadFrom === null || this.disposed || this.dead || this.unavailable || !this.pane.visible()) return false;
    if (this.time.now() < this.suppressedUntil) return false;
    const from = this.rereadFrom;
    this.rereadFrom = null;
    this.discardQueue();
    this.pane.reread(from);
    return true;
  }

  writeQueued(): 'foreground' | 'background' | null {
    if (this.dead || this.unavailable) {
      this.discardAll();
      return null;
    }
    const taken = this.take(CHUNK_CHARS);
    if (taken === null) return null;
    this.armStall();
    const accepted = taken.foreground ? this.writeInline(taken, this.highPriority) : this.writeBackgroundChunk(taken, this.highPriority);
    if (!accepted) {
      this.discardQueue();
      return null;
    }
    return taken.foreground ? 'foreground' : 'background';
  }

  private flush(maxChars = Number.POSITIVE_INFINITY): void {
    if (!this.hasQueued()) return;
    this.scheduler.unqueue(this);
    if (this.dead || this.unavailable) {
      this.discardAll();
      return;
    }
    let written = 0;
    for (let taken = this.take(CHUNK_CHARS); taken !== null; taken = this.take(CHUNK_CHARS)) {
      this.armStall();
      const accepted = taken.foreground ? this.writeInline(taken, false) : this.writeBackgroundChunk(taken, false);
      if (!accepted) {
        this.discardQueue();
        return;
      }
      written += taken.data.length;
      if (written >= maxChars) break;
    }
    if (this.hasQueued()) {
      this.scheduler.queue(this);
      this.scheduler.scheduleDrain(0);
      return;
    }
    this.highPriority = false;
  }

  private writeInline(taken: Take, pacer: boolean): boolean {
    const complete = this.registerInFlight(taken.done);
    const before = taken.forceRefresh ? this.viewport() : null;
    const onParsed = (): void => {
      this.hop('parsed', null, null);
      if (before !== null) this.scheduler.guard('foreground-render-settle', () => this.settleRender(before));
      this.scheduler.guard('foreground-on-parsed', () => this.completeParse(complete, pacer));
    };
    try {
      this.target.write(taken.data, onParsed);
      return true;
    } catch {
      this.scheduler.guard('foreground-on-write-failure', () => this.completeFailure(complete));
      return false;
    }
  }

  private writeBackgroundChunk(taken: Take, pacer: boolean): boolean {
    const complete = this.registerInFlight(taken.done);
    try {
      this.target.write(taken.data, () => {
        this.hop('parsed', null, null);
        this.scheduler.guard('background-on-parsed', () => this.completeParse(complete, pacer));
      });
      return true;
    } catch {
      this.scheduler.guard('background-on-write-failure', () => this.completeFailure(complete));
      return false;
    }
  }

  private completeParse(complete: () => void, pacer: boolean): void {
    try {
      complete();
    } finally {
      if (pacer) this.scheduler.pace();
      this.settleStall();
      this.checkRetention();
      this.hop('settled', null, null);
    }
  }

  private checkRetention(): void {
    if (this.unavailable || this.dead || this.disposed) return;
    const refusal = this.retention.check();
    if (refusal === null) {
      this.pane.onRetained?.();
      return;
    }
    this.unavailable = true;
    this.cancelStall();
    this.discardAll();
    try {
      this.pane.unavailable?.(refusal);
    } catch (error: unknown) {
      console.error('[terminal] the pane refused the retention certificate', error);
    }
  }

  private completeFailure(complete: () => void): void {
    try {
      complete();
    } finally {
      this.certifyDead();
    }
  }

  private registerInFlight(done: (() => void)[]): () => void {
    const complete = once(() => {
      this.inFlight.delete(complete);
      for (const release of done) release();
    });
    if (done.length > 0) this.inFlight.add(complete);
    return complete;
  }

  private viewport(): { baseY: number; viewportY: number } {
    const active = this.target.buffer.active;
    return { baseY: active.baseY, viewportY: active.viewportY };
  }

  private settleRender(before: { baseY: number; viewportY: number }): void {
    if (this.scheduler.inTick) {
      if (this.settleBefore === null) this.settleBefore = before;
      this.scheduler.settleAtTickEnd(this);
      return;
    }
    this.refreshSettled(before);
  }

  settleNow(): void {
    const before = this.settleBefore;
    if (before === null) return;
    this.settleBefore = null;
    this.refreshSettled(before);
  }

  private refreshSettled(before: { baseY: number; viewportY: number }): void {
    this.refreshRows();
    const after = this.viewport();
    if (after.baseY !== before.baseY || after.viewportY !== before.viewportY) {
      this.settle?.();
      this.settle = this.time.frame(() => {
        this.settle = null;
        this.refreshRows();
      });
    }
  }

  private refreshRows(): void {
    const rows = this.target.rows;
    if (!(rows >= 1)) return;
    try {
      const sync = !this.pane.webgl();
      if (sync && typeof this.target._core?.refresh === 'function') {
        this.target._core.refresh(0, rows - 1, true);
        return;
      }
      this.target.refresh(0, rows - 1);
    } catch {}
  }

  private armStall(mode: StallMode = 'completion'): void {
    if (this.dead || this.disposed || this.unavailable) return;
    if (this.stall !== null) {
      if (mode === 'probe') this.stall.mode = 'probe';
      return;
    }
    const watch: StallWatch = { mode, cancel: () => undefined };
    const quietWindow = (since: number): void => {
      watch.cancel = this.time.after(STALL_CHECK_MS, () => {
        if (this.stall !== watch) return;
        if (this.parseGeneration !== since) {
          quietWindow(this.parseGeneration);
          return;
        }
        this.certifyDead();
      });
    };
    watch.cancel = this.time.after(STALL_CHECK_MS, () => {
      if (this.stall !== watch) return;
      const since = this.parseGeneration;
      try {
        this.target.write('', () => {
          this.parseGeneration += 1;
          if (this.stall === watch) {
            watch.cancel();
            this.stall = null;
          }
        });
      } catch {
        this.certifyDead();
        return;
      }
      if (this.stall === watch) quietWindow(since);
    });
    this.stall = watch;
  }

  private requestProbe(): void {
    this.armStall('probe');
  }

  private settleStall(): void {
    this.parseGeneration += 1;
    if (this.stall?.mode === 'probe') return;
    this.cancelStall();
  }

  private cancelStall(): void {
    this.stall?.cancel();
    this.stall = null;
  }

  private certifyDead(): void {
    if (this.dead) return;
    this.dead = true;
    this.cancelStall();
    this.discardAll();
    try {
      this.pane.dead();
    } catch (error: unknown) {
      console.error('[terminal] the pane refused the dead-pipeline certificate', error);
    }
  }

  private discardQueue(): void {
    for (let index = this.head; index < this.chunks.length; index += 1) {
      for (const release of (this.chunks[index] as Chunk).done) release();
    }
    this.chunks = [];
    this.head = 0;
    this.queuedChars = 0;
    this.highPriority = false;
    this.scheduler.unqueue(this);
  }

  private discardAll(): void {
    this.discardQueue();
    for (const complete of [...this.inFlight]) complete();
    this.settle?.();
    this.settle = null;
    this.settleBefore = null;
    this.cancelStall();
  }
}

export class TerminalOutput extends Service<TerminalOutput>()('TerminalOutput', { tier: 'app' }) {
  static *make() {
    return new TerminalOutput(pageTime(), pageHidden, yield* Scope);
  }

  private readonly entries = new Set<Entry>();
  private readonly queued = new Set<Entry>();
  private readonly settling = new Set<Entry>();
  private ticking = false;
  private drainTimer: (() => void) | null = null;
  private drainDelay: number | null = null;
  private postPending = false;
  private postGeneration = 0;
  private readonly inactiveBudget: Budget = { chars: 0, windowStart: 0 };
  private readonly reports = new Map<string, number>();

  constructor(
    private readonly time: Time,
    private readonly hidden: () => boolean,
    scope: Scope,
  ) {
    super();
    scope.defer(() => this.close());
  }

  register(target: OutputTarget, pane: PaneOutput): Writer {
    const entry = new Entry(this, this.time, target, pane, new TerminalRetention(target));
    this.entries.add(entry);
    return entry;
  }

  queue(entry: Entry): void {
    this.queued.add(entry);
  }

  unqueue(entry: Entry): void {
    this.queued.delete(entry);
  }

  forget(entry: Entry): void {
    this.queued.delete(entry);
    this.settling.delete(entry);
    this.entries.delete(entry);
  }

  get inTick(): boolean {
    return this.ticking;
  }

  settleAtTickEnd(entry: Entry): void {
    this.settling.add(entry);
  }

  consumeInactiveBudget(now: number, length: number): boolean {
    return consumeBudget(this.inactiveBudget, now, length, INACTIVE_FOREGROUND_IMMEDIATE_BUDGET_CHARS);
  }

  pace(): void {
    if (this.hasHighPriorityBacklog()) this.scheduleDrain(0);
  }

  guard(context: string, step: () => void): void {
    try {
      step();
    } catch (error: unknown) {
      const reported = this.reports.get(context) ?? 0;
      if (reported >= MAX_REPORTS_PER_CONTEXT) return;
      this.reports.set(context, reported + 1);
      console.error(`[terminal] write-completion step "${context}" threw`, error);
    }
  }

  scheduleDrain(delayMs: number): void {
    if (this.postPending) return;
    const posted = delayMs === 0 || this.hidden();
    if (this.drainTimer !== null) {
      if (!posted && this.drainDelay !== null && this.drainDelay <= delayMs) return;
      this.drainTimer();
      this.drainTimer = null;
      this.drainDelay = null;
    }
    if (this.queued.size === 0) return;
    if (posted) {
      this.postPending = true;
      const generation = ++this.postGeneration;
      this.time.post(() => {
        if (generation !== this.postGeneration || !this.postPending) return;
        this.postPending = false;
        this.drain();
      });
      return;
    }
    this.drainTimer = this.time.after(delayMs, () => this.drain());
    this.drainDelay = delayMs;
  }

  private drain(): void {
    this.drainTimer = null;
    this.drainDelay = null;
    const startedAt = this.time.now();
    const highPriority = this.hasHighPriorityBacklog();
    const maxWrites = highPriority ? HIGH_PRIORITY_WRITES_PER_TICK : WRITES_PER_TICK;
    let writes = 0;
    this.ticking = true;
    try {
      while (this.queued.size > 0 && writes < maxWrites) {
        const entry = this.takeNext();
        if (entry === null) break;
        if (entry.writeQueued() !== null) writes += 1;
        if (entry.hasQueued()) this.queued.add(entry);
        else entry.highPriority = false;
        if (writes > 0 && this.time.now() - startedAt >= DRAIN_BUDGET_MS) break;
      }
    } finally {
      this.ticking = false;
    }
    this.settleTick();
    if (this.queued.size > 0) this.scheduleDrain(this.hasHighPriorityBacklog() ? 0 : BACKGROUND_DRAIN_INTERVAL_MS);
  }

  private settleTick(): void {
    if (this.settling.size === 0) return;
    const settling = [...this.settling];
    this.settling.clear();
    for (const entry of settling) this.guard('settle-tick', () => entry.settleNow());
  }

  private takeNext(): Entry | null {
    let large: Entry | null = null;
    for (const entry of this.queued) {
      if (entry.highPriority) {
        this.queued.delete(entry);
        return entry;
      }
      if (large === null && entry.queuedChars > LARGE_BACKLOG_CHARS) large = entry;
    }
    if (large !== null) {
      this.queued.delete(large);
      return large;
    }
    for (const entry of this.queued) {
      this.queued.delete(entry);
      return entry;
    }
    return null;
  }

  private hasHighPriorityBacklog(): boolean {
    for (const entry of this.queued) {
      if (entry.highPriority || entry.queuedChars > LARGE_BACKLOG_CHARS) return true;
    }
    return false;
  }

  private close(): void {
    this.postGeneration += 1;
    this.postPending = false;
    this.drainTimer?.();
    this.drainTimer = null;
    this.drainDelay = null;
    this.settling.clear();
    for (const entry of [...this.entries]) entry.dispose();
  }
}
