import type { InputAnswer } from '@runlith/executions/protocol/input';
import type { TerminalInputReceipt } from '@tagma/server/executions/contract/wire/viewLeases';
import type { LiveConnection, LiveFailure } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { composingNow, compositionOpen, newComposition, type Composition } from './engineGuards.js';
import { markTerminalInput } from './terminalChainRecord.js';
import { kittyKeyboardFlags } from './engineOptions.js';
import type { Engine } from './terminalEngine.js';
import type { LayoutCategory, TerminalAct, TerminalKeymap } from './Keymap.js';
import type { Writer } from './Output.js';
import type { ExecutionAddress, InputAct, ExecutionsRepo } from '../Repo.js';

type Repo = ReturnType<typeof ExecutionsRepo.use>;

export const INPUT_COALESCE_MAX_CODE_UNITS = 4096;
export const HOST_INPUT_ADMISSION_BYTES = 16 * 1024;
export const INPUT_WINDOW_ACTS = (512 * 1024) / HOST_INPUT_ADMISSION_BYTES;
export const INPUT_MAX_BYTES = 16 * 1024 * 1024;
export const PASTE_MAX_BYTES = 16 * 1024 * 1024;
export const PASTE_OPERATION_TIMEOUT_MS = 30_000;
export const BACKPRESSURE_WAIT_MS = 20;
export const RETENTION_MAX_ITEMS = 1024;
export const IME_NEWLINE_FALLBACK_MS = 200;
export const IME_CHORD_ABANDON_MS = 10_000;
const NO_GRANT = 'terminal-no-grant';
const STALE = 'terminal-stale';
const HOST_REFUSED = 'terminal-host-refused-';
const INPUT_FENCED = `${HOST_REFUSED}InputFenced`;
const INPUT_YIELDING = `${HOST_REFUSED}InputYielding`;
const UNSUPPORTED = `${HOST_REFUSED}UnsupportedCapability`;

const isLaneRefusal = (code: string): boolean =>
  code === NO_GRANT || code === STALE || (code.startsWith(HOST_REFUSED) && code !== INPUT_FENCED && code !== UNSUPPORTED);

export interface Clipboard {
  readText(): Promise<string>;
  readPicture(): Promise<Blob | null>;
  writeText(text: string): Promise<void>;
}

export interface Clock {
  wait(ms: number): Promise<void>;
  now(): number;
}

export interface TerminalInputOptions {
  readonly osc52?: boolean;
  readonly replaying?: () => boolean;
  readonly onProblem?: (problem: string) => void;
  readonly onEnded?: () => void;
  readonly composition?: Composition;
  readonly candidateKeysArrivePlain?: boolean;
  readonly beforeSend?: (act: InputAct) => InputAct;
  readonly focused?: () => boolean;
}

export interface HeldLane {
  readonly binding: string;
  readonly sequence: number;
}

export interface KeyContext {
  readonly layout?: LayoutCategory;
}

export type ActVerdict = 'applied' | 'refused' | 'lost';

type WriteCause = 'typed' | 'raw' | 'mouse' | 'paste';

interface PasteToken {
  cancelled: boolean;
  pending: number;
  failed: boolean;
  settled: boolean;
  settle: (ok: boolean) => void;
}

interface WriteItem {
  readonly tag: 'write';
  readonly text: string;
  readonly cause: WriteCause;
  readonly token: PasteToken | null;
}

interface InterruptItem {
  readonly tag: 'interrupt';
  readonly settle: (verdict: ActVerdict) => void;
}

type QueueItem = WriteItem | InterruptItem;

type ActRoad = 'socket' | 'http';

interface SentAct {
  readonly act: InputAct;
  readonly consumed: readonly QueueItem[];
  readonly size: number;
  readonly cause: WriteCause | 'interrupt';
  readonly road: ActRoad;
  owed: boolean;
}

const ESC = String.fromCharCode(0x1b);
const ETX = String.fromCharCode(0x03);
const INERT_ESCAPE = '␛';
const BRACKETED_PASTE_START = `${ESC}[200~`;
const BRACKETED_PASTE_END = `${ESC}[201~`;
const LINE_BREAK_RE = /[\r\n]/;

const LOST_ON_LANE = 'typing whose landing could not be confirmed was not repeated';
const UNSENT_ON_LANE = 'typing that had not reached this terminal was dropped';

const CURSOR_OR_STATUS_REPLY_RE = new RegExp('^\\u001b\\[\\??[0-9;]*[Rn]');
const DEVICE_ATTRIBUTES_REPLY_RE = new RegExp('^\\u001b\\[[?>=]?[0-9;]*c');
const WINDOW_SIZE_REPLY_RE = new RegExp('^\\u001b\\[[468];[0-9]+;[0-9]+t');
const MODE_REPORT_REPLY_RE = new RegExp('^\\u001b\\[\\??[0-9;]*\\$y');
const KITTY_FLAGS_REPLY_RE = new RegExp('^\\u001b\\[\\?[0-9]+u');
const OSC_RESPONSE_REPLY_RE = new RegExp('^\\u001b\\][0-9]+;[^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)');
const DCS_RESPONSE_REPLY_RE = new RegExp('^\\u001bP(?:[01]\\$r[^\\u001b]*|>\\|[^\\u001b]*)\\u001b\\\\');

const QUERY_REPLY_RES = [
  CURSOR_OR_STATUS_REPLY_RE,
  DEVICE_ATTRIBUTES_REPLY_RE,
  WINDOW_SIZE_REPLY_RE,
  MODE_REPORT_REPLY_RE,
  KITTY_FLAGS_REPLY_RE,
  OSC_RESPONSE_REPLY_RE,
  DCS_RESPONSE_REPLY_RE,
] as const;

function replyEnd(data: string, start: number): number {
  if (start >= data.length || data[start] !== ESC) return -1;
  const rest = data.slice(start);
  for (const grammar of QUERY_REPLY_RES) {
    const match = grammar.exec(rest);
    if (match?.[0] !== undefined && match[0] !== '') return start + match[0].length;
  }
  return -1;
}

function onlyQueryReplies(data: string): boolean {
  if (data.length < 3 || data[0] !== ESC) return false;
  let offset = 0;
  while (offset < data.length) {
    const end = replyEnd(data, offset);
    if (end === -1) return false;
    offset = end;
  }
  return true;
}

const SGR_MOUSE_RE = new RegExp('^\\u001b\\[<(\\d+);\\d+;\\d+[Mm]');
const X10_MOUSE = `${ESC}[M`;
const FOCUS_REPORT_RE = new RegExp('^\\u001b\\[[IO]');
const MOUSE_MOTION = 32;
const MOUSE_NO_BUTTON = 3;
const MOUSE_WHEEL = 64;

type Composed = 'hover' | 'report' | 'mouse' | 'typed';

function composedBy(data: string): Composed {
  let offset = 0;
  let hover = true;
  let acted = false;
  while (offset < data.length) {
    const rest = data.slice(offset);
    const focus = FOCUS_REPORT_RE.exec(rest);
    if (focus !== null) {
      hover = false;
      offset += focus[0].length;
      continue;
    }
    const sgr = SGR_MOUSE_RE.exec(rest);
    let code: number;
    if (sgr?.[1] !== undefined) {
      code = Number(sgr[1]);
      offset += sgr[0].length;
    } else if (rest.startsWith(X10_MOUSE) && rest.length >= X10_MOUSE.length + 3) {
      code = rest.charCodeAt(X10_MOUSE.length) - 32;
      offset += X10_MOUSE.length + 3;
    } else return 'typed';
    if ((code & MOUSE_MOTION) === 0 || (code & MOUSE_NO_BUTTON) !== MOUSE_NO_BUTTON || (code & MOUSE_WHEEL) !== 0) {
      hover = false;
      acted = true;
    }
  }
  if (offset === 0) return 'typed';
  return acted ? 'mouse' : hover ? 'hover' : 'report';
}

function imeConsumed(event: KeyboardEvent): boolean {
  return event.key === 'Process' && event.keyCode === 229;
}

function candidateKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return event.key === ' ' || (event.key.length === 1 && event.key >= '0' && event.key <= '9');
}

function claimed(event: KeyboardEvent): false {
  event.preventDefault();
  event.stopImmediatePropagation();
  return false;
}

const MAX_OSC52_BASE64_CHARS = 128 * 1024;

function parseOsc52Write(data: string): string | null {
  const semi = data.indexOf(';');
  if (semi === -1) return null;
  const selections = data.slice(0, semi) || 'c';
  if (!/^[cpqs0-7]+$/.test(selections)) return null;
  const payload = data.slice(semi + 1);
  if (payload === '?') return null;
  if (payload.length > MAX_OSC52_BASE64_CHARS) return null;
  const stripped = payload.replace(/[\t\n\f\r ]+/g, '');
  if (!/^[A-Za-z0-9+/=]*$/.test(stripped)) return null;
  try {
    const binary = atob(stripped);
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

function sanitizePaste(text: string): string {
  return text.includes(ESC) ? text.split(ESC).join(INERT_ESCAPE) : text;
}

function normalizePasteLineEndings(text: string): string {
  return text.replace(/\r?\n/g, '\r');
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function splitUtf8(text: string, maxBytes: number): string[] {
  if (utf8Length(text) <= maxBytes) return text === '' ? [] : [text];
  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (chunk !== '' && chunkBytes + size > maxBytes) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += char;
    chunkBytes += size;
  }
  if (chunk !== '') chunks.push(chunk);
  return chunks;
}

const base64Of = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const bytesOf = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
};

const wireAct = (act: InputAct): { readonly _tag: 'Write'; readonly bytes: Uint8Array } | { readonly _tag: 'Interrupt' } =>
  act._tag === 'Write' ? { _tag: 'Write', bytes: bytesOf(act.bytes) } : { _tag: 'Interrupt' };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const sameAddress = (a: ExecutionAddress, b: ExecutionAddress | null): boolean =>
  b !== null && a.execution === b.execution && a.incarnation === b.incarnation;

export class TerminalInput {
  private address: ExecutionAddress | null = null;
  private view: string | null = null;
  private binding: string | null = null;
  private sequence = 0;
  private epoch = 0;
  private opening: { readonly epoch: number; readonly done: Promise<void> } | null = null;
  private attached = false;
  private observing = false;
  private ended = false;
  private reopened = false;
  private renewing = false;

  private queue: QueueItem[] = [];
  private flushing = false;
  private drainQueued = false;
  private outstanding = new Map<number, SentAct>();
  private refusedAt: number | null = null;
  private stranded: { readonly sequence: number; readonly entry: SentAct }[] = [];
  private retry: number | null = null;
  private parked = false;
  private parkWake: (() => void) | null = null;
  private answers: { readonly receipts: { unsubscribe: () => void }; readonly status: () => void } | null = null;

  private disposables: { dispose(): void }[] = [];
  private readonly composition: Composition;
  private readonly deferrals = new Set<() => void>();
  private bracketed = false;
  private bracketInterrupted = false;
  private layout: LayoutCategory = 'unknown';
  private actListener: ((act: TerminalAct) => boolean) | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly repo: Repo,
    private readonly keymap: TerminalKeymap,
    private readonly clipboard: Clipboard,
    private readonly clock: Clock,
    private readonly live: LiveConnection,
    private readonly writer: Writer,
    private readonly projectId: number,
    private admission: number,
    private readonly options: TerminalInputOptions = {},
  ) {
    this.composition = options.composition ?? newComposition();
    this.setWritable(false);
  }

  private setWritable(enabled: boolean): void {
    const terminal = this.engine.terminal;
    if (terminal.options.disableStdin === !enabled) return;
    terminal.options.disableStdin = !enabled;
    terminal.refresh(0, terminal.rows - 1);
  }

  onAct(listener: (act: TerminalAct) => boolean): void {
    this.actListener = listener;
  }

  setKeyContext(context: KeyContext): void {
    if (context.layout !== undefined) this.layout = context.layout;
  }

  setBracketedPaste(enabled: boolean): void {
    this.bracketed = enabled;
    this.bracketInterrupted = false;
  }

  attach(address: ExecutionAddress, view: string, carried: HeldLane | null = null): void {
    this.enter(address);
    this.view = view;
    if (this.binding === null && carried !== null) {
      this.binding = carried.binding;
      this.sequence = carried.sequence;
    }
    if (this.binding !== null) {
      this.listen();
      this.scheduleDrain();
    } else if (this.queue.length > 0) void this.openLane();
  }

  observe(): void {
    this.detach();
    this.observing = true;
    this.engine.terminal.attachCustomKeyEventHandler(this.handleKey);
  }

  focused(): void {
    if (this.attached && this.binding === null && !this.ended) void this.openLane();
  }

  renew(): void {
    if (!this.attached || this.ended) return;
    this.reopened = false;
    const opening = this.opening;
    const epoch = this.epoch;
    if (this.binding === null) {
      if (opening !== null && opening.epoch === epoch) {
        void opening.done.then(() => {
          if (this.epoch === epoch) this.renew();
        });
      }
      return;
    }
    if (this.outstanding.size > 0 || this.stranded.length > 0 || this.parked) {
      this.renewing = true;
      return;
    }
    this.recover(this.sequence + 1, false);
  }

  lane(): HeldLane | null {
    if (this.binding === null) return null;
    if (this.outstanding.size > 0 || this.stranded.length > 0) return null;
    return { binding: this.binding, sequence: this.sequence };
  }

  private enter(address: ExecutionAddress): void {
    this.detach();
    const standing = this.address;
    if (standing !== null && !sameAddress(address, standing)) {
      this.sequence = 0;
      this.binding = null;
      this.reopened = false;
      this.renewing = false;
      this.ended = false;
      this.carry();
    }
    this.address = address;
    this.attached = true;
    this.setWritable(!this.ended);
    const terminal = this.engine.terminal;
    this.disposables.push(terminal.onData((data) => this.ingest(data)));
    this.disposables.push(terminal.onBinary((data) => this.ingest(data)));
    terminal.attachCustomKeyEventHandler(this.handleKey);
    this.disposables.push(terminal.parser.registerOscHandler(52, (data) => this.handleOsc52(data)));
  }

  detach(): void {
    this.attached = false;
    this.observing = false;
    this.setWritable(false);
    this.epoch += 1;
    for (const drop of [...this.deferrals]) drop();
    for (const held of this.disposables) {
      try {
        held.dispose();
      } catch {}
    }
    this.disposables = [];
    this.unlisten();
    this.park();
  }

  async release(): Promise<void> {
    this.detach();
    const address = this.address;
    const binding = this.binding;
    const window = [...this.outstanding.values()];
    const unanswered = window.some((entry) => !entry.owed);
    const unsent = this.queue.length > 0 || this.stranded.length > 0 || window.length > 0;
    this.stall(unanswered ? LOST_ON_LANE : unsent ? UNSENT_ON_LANE : null);
    if (address !== null && binding !== null) await this.closeLane(address, binding);
  }

  paste(text: string): Promise<boolean> {
    if (text === '') return Promise.resolve(true);
    if (this.bracketInterrupted && this.bracketed && !LINE_BREAK_RE.test(text)) {
      return this.enqueuePaste(sanitizePaste(normalizePasteLineEndings(text)));
    }
    this.bracketInterrupted = false;
    return this.pasteEach([text], '');
  }

  pasteEach(pieces: readonly string[], gap: string): Promise<boolean> {
    let sent = '';
    for (const piece of pieces) {
      if (piece === '') continue;
      sent += this.bracketed
        ? `${BRACKETED_PASTE_START}${sanitizePaste(normalizePasteLineEndings(piece))}${BRACKETED_PASTE_END}`
        : normalizePasteLineEndings(piece);
      sent += gap;
    }
    return this.enqueuePaste(sent);
  }

  private enqueuePaste(sent: string): Promise<boolean> {
    if (sent === '') return Promise.resolve(true);
    if (!this.admits()) return Promise.resolve(false);
    if (utf8Length(sent) > PASTE_MAX_BYTES) return Promise.resolve(false);
    const framed = splitUtf8(sent, this.admission);
    if (framed.length === 0) return Promise.resolve(true);
    let resolvePaste: (ok: boolean) => void = () => undefined;
    const done = new Promise<boolean>((resolve) => {
      resolvePaste = resolve;
    });
    const token: PasteToken = {
      cancelled: false,
      pending: framed.length,
      failed: false,
      settled: false,
      settle: (ok) => {
        if (!token.settled) {
          token.settled = true;
          resolvePaste(ok);
        }
      },
    };
    for (const chunk of framed) {
      this.queue.push({ tag: 'write', text: chunk, cause: 'paste', token });
    }
    this.capRetention();
    this.demand();
    this.scheduleDrain();
    void this.clock.wait(PASTE_OPERATION_TIMEOUT_MS).then(() => {
      token.cancelled = true;
      token.settle(false);
    });
    return done;
  }

  async pasteFromClipboard(picture?: (held: Blob) => Promise<boolean>): Promise<boolean> {
    let text: string;
    try {
      text = await this.clipboard.readText();
    } catch {
      return false;
    }
    if (text !== '' || picture === undefined) return this.paste(text);
    let held: Blob | null;
    try {
      held = await this.clipboard.readPicture();
    } catch {
      return false;
    }
    return held === null ? true : picture(held);
  }

  async copy(): Promise<boolean> {
    const selection = this.engine.terminal.getSelection();
    if (!selection) return false;
    try {
      await this.clipboard.writeText(selection);
    } catch {
      return false;
    }
    return true;
  }

  async interrupt(): Promise<void> {
    if (this.bracketed) this.bracketInterrupted = true;
    if (!this.admits()) return;
    if ((await this.enqueueInterrupt()) === 'refused') {
      this.enqueueOrdinary(ETX, 'typed');
    }
  }

  private readonly handleKey = (event: KeyboardEvent): boolean => {
    if ((!this.attached && !this.observing) || event.type !== 'keydown') return true;
    const at = this.clock.now();
    if (event.isComposing === true || imeConsumed(event)) return true;
    if (this.options.candidateKeysArrivePlain === true && candidateKey(event) && composingNow(at, this.composition)) {
      return claimed(event);
    }
    const resolution = this.keymap.resolve(event, {
      kitty: kittyKeyboardFlags(this.engine.terminal) > 0,
      hasSelection: this.engine.terminal.hasSelection(),
      layout: this.layout,
      inTerminal: true,
    });
    if (resolution.kind === 'engine') return true;
    if (!this.attached && resolution.kind !== 'act') return claimed(event);
    if (resolution.kind === 'interrupt') {
      void this.interrupt();
      return claimed(event);
    }
    if (resolution.kind === 'bytes') {
      const text = new TextDecoder().decode(resolution.bytes);
      markTerminalInput({ stage: 'keydown', sequence: null, binding: this.binding, road: null, bytes: utf8Length(text) });
      if (compositionOpen(at, this.composition)) this.hold(text);
      else this.enqueueOrdinary(text, 'typed');
      return claimed(event);
    }
    if (this.actListener?.(resolution.act) === false) return false;
    return claimed(event);
  };

  private hold(text: string): void {
    const composition = this.composition;
    const newline = LINE_BREAK_RE.test(text);
    let settled = false;
    const drop = (): void => {
      if (settled) return;
      settled = true;
      this.deferrals.delete(drop);
      composition.waiting.delete(send);
    };
    const send = (): void => {
      if (settled) return;
      drop();
      void this.clock.wait(0).then(() => this.enqueueOrdinary(text, 'typed'));
    };
    composition.waiting.add(send);
    this.deferrals.add(drop);
    void this.clock.wait(newline ? IME_NEWLINE_FALLBACK_MS : IME_CHORD_ABANDON_MS).then(newline ? send : drop);
  }

  private ingest(data: string): void {
    if (data === '') return;
    if (onlyQueryReplies(data)) return;
    const composed = composedBy(data);
    if (composed === 'hover' && this.options.focused?.() === false) return;
    this.enqueueOrdinary(data, composed === 'typed' || composed === 'mouse' ? composed : 'raw');
  }

  private handleOsc52(data: string): boolean {
    const text = parseOsc52Write(data);
    if (text === null) return true;
    if (this.options.osc52 === false) return true;
    if (this.options.replaying?.() === true) return true;
    void this.clipboard.writeText(text).catch((error: unknown) => {
      this.fail(messageOf(error));
    });
    return true;
  }

  private admits(): boolean {
    if (this.observing) return false;
    if (this.ended) {
      this.fail('this terminal takes no more input');
      return false;
    }
    return true;
  }

  private enqueueOrdinary(text: string, cause: WriteCause): boolean {
    if (text === '') return false;
    if (!this.admits()) return false;
    if (utf8Length(text) > INPUT_MAX_BYTES) return false;
    for (const chunk of splitUtf8(text, this.admission)) {
      this.queue.push({ tag: 'write', text: chunk, cause, token: null });
    }
    this.capRetention();
    this.demand();
    this.scheduleDrain();
    return true;
  }

  private demand(): void {
    if (this.attached && this.binding === null) void this.openLane();
  }

  private enqueueInterrupt(): Promise<ActVerdict> {
    if (this.ended) return Promise.resolve<ActVerdict>('lost');
    let settleInterrupt: (verdict: ActVerdict) => void = () => undefined;
    const done = new Promise<ActVerdict>((resolve) => {
      settleInterrupt = resolve;
    });
    let settled = false;
    this.queue.push({
      tag: 'interrupt',
      settle: (verdict) => {
        if (!settled) {
          settled = true;
          settleInterrupt(verdict);
        }
      },
    });
    this.demand();
    this.scheduleDrain();
    return done;
  }

  private capRetention(): void {
    while (this.queue.length > RETENTION_MAX_ITEMS) {
      const dropped = this.queue.shift();
      if (dropped !== undefined) this.settleWaiters([dropped], 'lost');
    }
  }

  private scheduleDrain(): void {
    if (this.drainQueued) return;
    this.drainQueued = true;
    queueMicrotask(() => {
      this.drainQueued = false;
      void this.flush();
    });
  }

  private dropCancelledHeads(): void {
    for (;;) {
      const head = this.queue[0];
      if (head?.tag !== 'write' || head.token?.cancelled !== true) return;
      this.queue.shift();
      if (head.token !== null && !head.token.settled) {
        head.token.pending -= 1;
        if (head.token.pending <= 0) head.token.settle(false);
      }
    }
  }

  private settleWaiters(consumed: readonly QueueItem[], verdict: ActVerdict): void {
    for (const item of consumed) {
      if (item.tag === 'write') {
        const token = item.token;
        if (token === null || token.settled) continue;
        token.pending -= 1;
        token.failed = token.failed || verdict !== 'applied';
        if (token.pending <= 0) token.settle(!token.failed);
      } else {
        item.settle(verdict);
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    let replaced = false;
    try {
      for (;;) {
        const binding = this.binding;
        const address = this.address;
        if (binding === null || address === null || this.ended) return;
        if (this.answers === null) return;
        if (this.parked) {
          if (this.outstanding.size === 0) {
            this.parked = false;
            continue;
          }
          if (this.live.status === 'paused') return;
          await this.pace();
          if (this.binding !== binding || !sameAddress(address, this.address)) {
            replaced = true;
            return;
          }
          if (this.outstanding.size === 0) {
            this.parked = false;
            continue;
          }
          this.resend(0);
          continue;
        }
        if (this.refusedAt !== null) return;
        if (this.retry !== null) {
          const from = this.retry;
          this.retry = null;
          await this.clock.wait(BACKPRESSURE_WAIT_MS);
          if (this.binding !== binding || !sameAddress(address, this.address)) {
            replaced = true;
            return;
          }
          this.resend(from);
          continue;
        }
        const stranded = this.stranded.shift();
        if (stranded !== undefined) {
          this.send(this.sequence, stranded.entry);
          this.sequence += 1;
          continue;
        }
        this.dropCancelledHeads();
        const head = this.queue[0];
        if (head === undefined) return;
        if (head.tag === 'write' && head.cause === 'paste') {
          if (this.outstanding.size > 0) return;
          this.queue.shift();
          const sequence = this.sequence;
          this.sequence += 1;
          const entry = this.going({
            act: { _tag: 'Write', bytes: base64Of(head.text) },
            consumed: [head],
            size: utf8Length(head.text),
            cause: 'paste',
            road: 'http',
            owed: false,
          });
          this.outstanding.set(sequence, entry);
          markTerminalInput({ stage: 'sent', sequence, binding, road: null, bytes: entry.size });
          if (!(await this.sendPaste(sequence, entry))) return;
          continue;
        }
        if (this.outstanding.size >= INPUT_WINDOW_ACTS) return;
        this.queue.shift();
        this.send(this.sequence, this.build(head));
        this.sequence += 1;
      }
    } finally {
      this.flushing = false;
      if (replaced) this.scheduleDrain();
    }
  }

  private build(head: QueueItem): SentAct {
    if (head.tag === 'interrupt') {
      return this.going({ act: { _tag: 'Interrupt' }, consumed: [head], size: 0, cause: 'interrupt', road: 'socket', owed: false });
    }
    if (head.token !== null || head.text.length > INPUT_COALESCE_MAX_CODE_UNITS) {
      return this.going({
        act: { _tag: 'Write', bytes: base64Of(head.text) },
        consumed: [head],
        size: utf8Length(head.text),
        cause: head.cause,
        road: 'socket',
        owed: false,
      });
    }
    let payload = head.text;
    let size = utf8Length(head.text);
    const merged: QueueItem[] = [head];
    for (;;) {
      const peek = this.queue[0];
      if (
        peek?.tag !== 'write' ||
        peek.token !== null ||
        peek.cause !== head.cause ||
        peek.text.length > INPUT_COALESCE_MAX_CODE_UNITS ||
        payload.length + peek.text.length > INPUT_COALESCE_MAX_CODE_UNITS ||
        size + utf8Length(peek.text) > this.admission
      ) {
        break;
      }
      payload += peek.text;
      size += utf8Length(peek.text);
      merged.push(peek);
      this.queue.shift();
    }
    return this.going({
      act: { _tag: 'Write', bytes: base64Of(payload) },
      consumed: merged,
      size,
      cause: head.cause,
      road: 'socket',
      owed: false,
    });
  }

  private going(entry: SentAct): SentAct {
    const act = this.options.beforeSend?.(entry.act) ?? entry.act;
    this.writer.typed();
    return act === entry.act ? entry : { ...entry, act };
  }

  private send(sequence: number, entry: SentAct): void {
    this.outstanding.set(sequence, entry);
    this.write(sequence, entry);
  }

  private write(sequence: number, entry: SentAct): void {
    const binding = this.binding;
    const address = this.address;
    if (binding === null || address === null) return;
    markTerminalInput({ stage: 'sent', sequence, binding, road: null, bytes: entry.size });
    if (entry.road === 'http') {
      void this.sendPaste(sequence, entry);
      return;
    }
    void this.live
      .call((client) =>
        client['terminal.input.write']({
          projectId: this.projectId,
          execution: address.execution,
          incarnation: address.incarnation,
          binding,
          sequence,
          act: wireAct(entry.act),
          cause: entry.cause,
        }),
      )
      .catch((error: unknown) => this.failed(sequence, entry, error));
  }

  private async sendPaste(sequence: number, entry: SentAct): Promise<boolean> {
    const binding = this.binding;
    const address = this.address;
    if (binding === null || address === null) return true;
    try {
      const outcome = await this.repo.input.run({ ...address, binding, sequence, act: entry.act, cause: 'paste' }, { throwOnError: true });
      if (this.outstanding.get(sequence) !== entry) return true;
      this.wake();
      this.markReceipt(sequence, entry);
      if (outcome === undefined) {
        this.outstanding.delete(sequence);
        this.queue.unshift(...entry.consumed);
        this.sequence = sequence;
        this.fail('unknown input answer');
        return false;
      }
      if (outcome._tag === 'InputAdmitted') {
        this.outstanding.delete(sequence);
        this.landed(entry);
        return true;
      }
      if (outcome._tag === 'InputBackpressure') {
        this.pressured(sequence, entry, outcome);
        return true;
      }
      this.outstanding.delete(sequence);
      this.refused(sequence, entry, outcome);
    } catch (error) {
      this.failed(sequence, entry, error);
    }
    return true;
  }

  private onReceipt(receipt: TerminalInputReceipt): void {
    this.wake();
    if (this.refusedAt !== null && receipt.sequence > this.refusedAt) {
      const stranded = this.outstanding.get(receipt.sequence);
      if (stranded !== undefined) {
        this.outstanding.delete(receipt.sequence);
        this.stranded.push({ sequence: receipt.sequence, entry: stranded });
        this.drained();
      }
      return;
    }
    const entry = this.outstanding.get(receipt.sequence);
    if (entry === undefined) return;
    this.markReceipt(receipt.sequence, entry);
    switch (receipt.kind) {
      case 'applied':
        this.outstanding.delete(receipt.sequence);
        this.landed(entry);
        return;
      case 'backpressure':
        this.pressured(receipt.sequence, entry, receipt.outcome);
        return;
      case 'refused':
        this.outstanding.delete(receipt.sequence);
        this.refused(receipt.sequence, entry, receipt.outcome);
        return;
    }
  }

  private markReceipt(sequence: number, entry: SentAct): void {
    markTerminalInput({
      stage: 'receipt',
      sequence,
      binding: this.binding,
      road: null,
      bytes: entry.size,
    });
  }

  private landed(entry: SentAct): void {
    this.settleWaiters(entry.consumed, 'applied');
    this.reopened = false;
    this.scheduleDrain();
  }

  private pressured(sequence: number, entry: SentAct, outcome: InputAnswer): void {
    if (outcome._tag === 'InputBackpressure' && entry.size > outcome.limit) {
      this.admission = Math.min(this.admission, outcome.limit);
      this.outstanding.delete(sequence);
      this.settleWaiters(entry.consumed, 'refused');
      this.fail(`the host admits at most ${outcome.limit} bytes in one act and this one is ${entry.size}; it was not sent`);
      this.tookNothing(sequence);
      return;
    }
    this.retryAct(sequence, entry);
  }

  private retryAct(sequence: number, entry: SentAct): void {
    entry.owed = true;
    this.retry = this.retry === null ? sequence : Math.min(this.retry, sequence);
    this.scheduleDrain();
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.setWritable(false);
    this.stall(null);
    this.options.onEnded?.();
  }

  private refused(sequence: number, entry: SentAct, outcome: InputAnswer): void {
    switch (outcome._tag) {
      case 'InputConflict':
      case 'InputReceiptExpired': {
        const expired = outcome._tag === 'InputReceiptExpired';
        this.outstanding.set(sequence, entry);
        this.laneRefused(sequence, expired ? LOST_ON_LANE : 'typing stopped: this terminal refused the order of what was typed', expired);
        return;
      }
      case 'InputEnded':
        this.settleWaiters(entry.consumed, 'lost');
        this.end();
        return;
      case 'InputUnsupported':
        this.settleWaiters(entry.consumed, 'refused');
        if (outcome.act !== 'interrupt') this.fail(outcome.detail);
        this.tookNothing(sequence);
        return;
      default:
        this.queue.unshift(...entry.consumed);
        this.fail('unknown input answer');
        return;
    }
  }

  private tookNothing(sequence: number): void {
    this.sequence = sequence;
    if ([...this.outstanding.keys()].some((held) => held > sequence)) {
      this.refusedAt = sequence;
      return;
    }
    this.scheduleDrain();
  }

  private drained(): void {
    if (this.outstanding.size > 0 || this.refusedAt === null) return;
    this.refusedAt = null;
    this.stranded.sort((left, right) => left.sequence - right.sequence);
    this.scheduleDrain();
  }

  private failed(sequence: number, entry: SentAct, error: unknown): void {
    if (this.outstanding.get(sequence) !== entry) return;
    const refusal = refusalOf(error);
    if (refusal.code === 'transport') {
      this.park();
      return;
    }
    if (refusal.code === INPUT_YIELDING) {
      this.retryAct(sequence, entry);
      return;
    }
    if (refusal.code === INPUT_FENCED) {
      this.outstanding.delete(sequence);
      this.settleWaiters(entry.consumed, 'lost');
      this.end();
      return;
    }
    if (isLaneRefusal(refusal.code)) {
      this.laneRefused(sequence, refusal.reason, false);
      return;
    }
    this.outstanding.delete(sequence);
    this.settleWaiters(entry.consumed, 'lost');
    this.stall(`typing stopped: ${refusal.reason}`);
  }

  private laneRefused(sequence: number, problem: string, lost: boolean): void {
    if (this.renewing) {
      this.renewing = false;
      this.recover(sequence, lost);
      return;
    }
    if (this.reopened) {
      this.stall(problem);
      return;
    }
    this.reopened = true;
    this.recover(sequence, lost);
  }

  private recover(refusedAt: number, lost: boolean): void {
    const unanswered = lost || this.parked || [...this.outstanding].some(([sequence, entry]) => sequence < refusedAt && !entry.owed);
    const pairs: { readonly sequence: number; readonly entry: SentAct }[] = [
      ...[...this.outstanding.entries()].map(([sequence, entry]) => ({ sequence, entry })),
      ...this.stranded,
    ];
    const acts = pairs.sort((left, right) => left.sequence - right.sequence).map((held) => held.entry);
    this.clearWindow();
    if (unanswered) {
      for (const held of acts) this.settleWaiters(held.consumed, 'lost');
      this.settleWaiters(this.queue, 'lost');
      this.queue = [];
      this.reopened = false;
      this.fail(LOST_ON_LANE);
    } else {
      this.queue.unshift(...acts.flatMap((held) => held.consumed));
    }
    this.sequence = 0;
    this.unlisten();
    this.binding = null;
    void this.openLane();
  }

  private park(): void {
    if (this.outstanding.size === 0) return;
    this.parked = true;
    this.scheduleDrain();
  }

  private pace(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.parkWake = resolve;
      void this.clock.wait(BACKPRESSURE_WAIT_MS).then(() => this.wake());
    });
  }

  private wake(): void {
    const wake = this.parkWake;
    this.parkWake = null;
    wake?.();
  }

  private resend(from: number): void {
    const standing = [...this.outstanding.entries()].filter(([sequence]) => sequence >= from).sort((left, right) => left[0] - right[0]);
    for (const [sequence, entry] of standing) {
      if (this.outstanding.get(sequence) !== entry) continue;
      this.write(sequence, entry);
    }
  }

  private clearWindow(): void {
    this.outstanding.clear();
    this.stranded = [];
    this.refusedAt = null;
    this.retry = null;
    this.parked = false;
    this.wake();
  }

  private forget(): void {
    const acts = [...this.outstanding.values()];
    this.clearWindow();
    for (const held of acts) this.settleWaiters(held.consumed, 'lost');
  }

  private carry(): void {
    const kept: { readonly sequence: number; readonly entry: SentAct }[] = [];
    for (const [sequence, entry] of this.outstanding) {
      if (entry.owed) kept.push({ sequence, entry });
      else this.settleWaiters(entry.consumed, 'lost');
    }
    this.clearWindow();
    this.stranded = kept.sort((left, right) => left.sequence - right.sequence);
  }

  private listen(): void {
    const address = this.address;
    const binding = this.binding;
    if (address === null || binding === null) return;
    this.unlisten();
    const receipts = this.live.hold(
      (client) =>
        client['terminal.input.receipts']({
          projectId: this.projectId,
          execution: address.execution,
          incarnation: address.incarnation,
          binding,
        }),
      (receipt) => {
        if (this.binding === binding) this.onReceipt(receipt);
      },
      (failure) => this.answersFailed(failure),
    );
    const status = this.live.subscribeStatus((state) => {
      if (state === 'open' || state === 'idle') this.scheduleDrain();
    });
    this.answers = { receipts, status };
  }

  private unlisten(): void {
    const answers = this.answers;
    this.answers = null;
    answers?.receipts.unsubscribe();
    answers?.status();
  }

  private answersFailed(failure: LiveFailure): void {
    if (failure.kind === 'connection') {
      this.park();
      return;
    }
    this.stall(`typing stopped: ${failure.message}`);
  }

  private stall(problem: string | null): void {
    this.forget();
    this.unlisten();
    this.settleWaiters(this.queue, 'lost');
    this.queue = [];
    this.sequence = 0;
    this.binding = null;
    this.reopened = false;
    this.renewing = false;
    if (problem !== null) this.fail(problem);
  }

  private async requestLane(address: ExecutionAddress, view: string, epoch: number): Promise<void> {
    let answer: Awaited<ReturnType<Repo['laneOpen']['run']>>;
    for (;;) {
      try {
        answer = await this.repo.laneOpen.run({ ...address, view }, { throwOnError: true });
        break;
      } catch (error) {
        if (epoch !== this.epoch) return;
        const refusal = refusalOf(error);
        if (refusal.code !== 'transport') {
          this.stall(refusal.reason);
          return;
        }
        await this.clock.wait(BACKPRESSURE_WAIT_MS);
        if (epoch !== this.epoch) return;
        await this.connected();
        if (epoch !== this.epoch) return;
      }
    }
    if (answer === undefined) return;
    if (epoch !== this.epoch) {
      await this.closeLane(address, answer.binding);
      return;
    }
    if (this.opening?.epoch === epoch) this.opening = null;
    this.binding = answer.binding;
    this.sequence = 0;
    this.listen();
    void this.flush();
  }

  private connected(): Promise<void> {
    return new Promise<void>((resolve) => {
      let off: (() => void) | null = null;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        off?.();
        this.deferrals.delete(finish);
        resolve();
      };
      this.deferrals.add(finish);
      off = this.live.subscribeStatus((status) => {
        if (status === 'open' || status === 'idle') finish();
      });
      if (settled) off();
    });
  }

  private async closeLane(address: ExecutionAddress, binding: string): Promise<void> {
    try {
      await this.repo.laneClose.run({ ...address, binding }, { throwOnError: true });
    } catch {}
  }

  private openLane(): Promise<void> {
    const standing = this.opening;
    if (standing !== null && standing.epoch === this.epoch) return standing.done;
    const address = this.address;
    const view = this.view;
    if (!this.attached || address === null || view === null) return Promise.resolve();
    const epoch = this.epoch;
    const done: Promise<void> = this.requestLane(address, view, epoch).finally(() => {
      if (this.opening?.done === done) this.opening = null;
    });
    this.opening = { epoch, done };
    return done;
  }

  private fail(problem: string): void {
    try {
      this.options.onProblem?.(problem);
    } catch {}
  }
}
