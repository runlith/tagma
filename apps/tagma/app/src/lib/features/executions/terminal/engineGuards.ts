import type { ILinkProvider, Terminal } from '@xterm/xterm';
import { ZWJ_VERSION, zwjProvider } from '@runlith/executions/protocol/zwjWidths';
import type { Engine } from './terminalEngine.js';

export interface GuardOptions {
  readonly wheelSensitivity?: () => number | undefined;
  readonly shaping?: () => boolean;
  readonly now?: () => number;
  readonly mouseHideWhileTyping?: () => boolean;
  readonly composition?: Composition;
}

export function installGuards(engine: Engine, options: GuardOptions = {}): () => void {
  const releases: (() => void)[] = [
    guardParserHandlerRegistration(engine.terminal),
    syncFocusClass(engine.terminal),
    anchorImeCandidates(engine.terminal, options.now ?? Date.now, options.composition ?? newComposition()),
    shapeRtlRuns(engine.terminal, options.shaping ?? (() => false)),
    widenZwjSequences(engine.terminal),
    replayWheelReports(engine.terminal, options.wheelSensitivity ?? (() => undefined)),
    hideCursorWhileTyping(engine.terminal, options.mouseHideWhileTyping ?? (() => false)),
  ];

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const step of releases.reverse()) {
      try {
        step();
      } catch {}
    }
  };
  engine.onDispose(release);
  return release;
}

function guardLinkProvider(provider: ILinkProvider): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      let answered = false;
      try {
        provider.provideLinks(bufferLineNumber, (links) => {
          answered = true;
          callback(links);
        });
      } catch {
        if (!answered) callback(undefined);
      }
    },
  };
}

export function guardLinkProviderRegistration(terminal: Terminal): void {
  const register = terminal.registerLinkProvider.bind(terminal);
  terminal.registerLinkProvider = (provider: ILinkProvider) => register(guardLinkProvider(provider));
}

type ParserHandlerResult = boolean | Promise<boolean>;

function guardParserHandlerRegistration(terminal: Terminal): () => void {
  const parser = terminal.parser;
  const csi = parser.registerCsiHandler.bind(parser);
  const osc = parser.registerOscHandler.bind(parser);
  const guard =
    <Args extends unknown[]>(handler: (...args: Args) => ParserHandlerResult) =>
    (...args: Args): ParserHandlerResult => {
      try {
        return handler(...args);
      } catch (error: unknown) {
        console.error('[terminal] a parser handler threw; the sequence reads as not handled', error);
        return false;
      }
    };
  parser.registerCsiHandler = (id, callback) => csi(id, guard(callback));
  parser.registerOscHandler = (ident, callback) => osc(ident, guard(callback));
  return () => {
    parser.registerCsiHandler = csi;
    parser.registerOscHandler = osc;
  };
}

function syncFocusClass(terminal: Terminal): () => void {
  const root = terminal.element;
  if (!root) return () => undefined;

  const sync = (): void => {
    const rows = root.querySelector<HTMLElement>('.xterm-rows');
    rows?.classList.toggle('xterm-focus', root.classList.contains('focus'));
  };
  const scheduleSync = (): void => {
    sync();
    requestAnimationFrame(sync);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  root.addEventListener('focusin', scheduleSync);
  root.addEventListener('focusout', scheduleSync);
  scheduleSync();

  return () => {
    observer.disconnect();
    root.removeEventListener('focusin', scheduleSync);
    root.removeEventListener('focusout', scheduleSync);
  };
}

const STALE_COMPOSITION_MS = 10_000;
const POST_COMMIT_SILENCE_MS = 250;

export interface CandidateAnchor {
  readonly row: number;
  readonly column: number;
}

interface CellMetrics {
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
}

function anchorImeCandidates(terminal: Terminal, now: () => number, composition: Composition): () => void {
  const root = terminal.element;
  if (!root) return () => undefined;
  const textarea = terminal.textarea;
  const screen = root.querySelector<HTMLElement>('.xterm-screen');

  let metrics: CellMetrics | null = null;
  let deferred: number | null = null;

  const measure = (): CellMetrics | null => {
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    const width = rect.width / terminal.cols;
    const height = rect.height / terminal.rows;
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height, cols: terminal.cols, rows: terminal.rows };
  };

  const writeStyle = (property: 'top' | 'left', value: string): void => {
    if (textarea && textarea.style[property] !== value) textarea.style[property] = value;
  };

  const apply = (anchor: CandidateAnchor, cells: CellMetrics): void => {
    if (!textarea) return;
    const left = anchor.column * cells.width;
    const preedit = Number.parseFloat(textarea.style.width);
    writeStyle('top', `${anchor.row * cells.height}px`);
    writeStyle('left', `${Number.isFinite(preedit) ? Math.max(0, Math.min(left, cells.cols * cells.width - preedit)) : left}px`);
  };

  const handler = (event: Event): void => {
    const at = now();
    if (event.type === 'compositionstart') {
      composition.startedAt = at;
      composition.committedAt = null;
    }
    if (!composingNow(at, composition)) {
      composition.startedAt = null;
      return;
    }
    if (event.type !== 'compositionupdate' || metrics === null || metrics.cols !== terminal.cols || metrics.rows !== terminal.rows) {
      metrics = measure();
    }
    const cells = metrics;
    if (!cells) return;
    apply(candidateAnchor(terminal), cells);

    if (deferred !== null) window.clearTimeout(deferred);
    deferred = window.setTimeout(() => {
      deferred = null;
      if (textarea?.isConnected !== true || metrics === null) return;
      apply(candidateAnchor(terminal), metrics);
    }, 0);
  };

  const commit = (): void => commitComposition(now(), composition);

  root.addEventListener('compositionstart', handler);
  root.addEventListener('compositionupdate', handler);
  root.addEventListener('compositionend', commit);

  return () => {
    if (deferred !== null) window.clearTimeout(deferred);
    root.removeEventListener('compositionstart', handler);
    root.removeEventListener('compositionupdate', handler);
    root.removeEventListener('compositionend', commit);
    composition.startedAt = null;
    composition.committedAt = null;
  };
}

export interface Composition {
  startedAt: number | null;
  committedAt: number | null;
  readonly waiting: Set<() => void>;
}

export function newComposition(): Composition {
  return { startedAt: null, committedAt: null, waiting: new Set() };
}

export function commitComposition(at: number, composition: Composition): void {
  composition.startedAt = null;
  composition.committedAt = at;
  for (const waiting of [...composition.waiting]) {
    composition.waiting.delete(waiting);
    waiting();
  }
}

export function compositionOpen(at: number, composition: Composition): boolean {
  const { startedAt } = composition;
  return startedAt !== null && at - startedAt <= STALE_COMPOSITION_MS;
}

export function composingNow(at: number, composition: Composition): boolean {
  if (compositionOpen(at, composition)) return true;
  const { committedAt } = composition;
  return committedAt !== null && at - committedAt <= POST_COMMIT_SILENCE_MS;
}

export function candidateAnchor(terminal: Terminal): CandidateAnchor {
  const buffer = terminal.buffer.active;
  return { row: buffer.cursorY, column: Math.min(buffer.cursorX, terminal.cols - 1) };
}

const RTL_FLOOR = 0x0590;
const ZERO_WIDTH_JOINER = 0x200d;
const COMBINING_MARK = /\p{Mn}/u;

export function isStrongRtl(codePoint: number): boolean {
  return (
    (codePoint >= 0x0590 && codePoint <= 0x08ff) ||
    (codePoint >= 0xfb1d && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfeff) ||
    (codePoint >= 0x10800 && codePoint <= 0x10fff) ||
    (codePoint >= 0x1e800 && codePoint <= 0x1eeff)
  );
}

function isRunNeutral(charCode: number): boolean {
  if (charCode < 0x20) return false;
  if (charCode <= 0x7e) {
    const isLetter = (charCode >= 0x41 && charCode <= 0x5a) || (charCode >= 0x61 && charCode <= 0x7a);
    return !isLetter;
  }
  return charCode === 0xa0;
}

function isRunTransparent(codePoint: number): boolean {
  return (
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0x200f ||
    codePoint === 0x061c ||
    (codePoint >= 0x0600 && codePoint <= 0x0605) ||
    codePoint === 0x06dd ||
    codePoint === 0x070f ||
    codePoint === 0x08e2 ||
    codePoint === 0xfeff
  );
}

export function rtlJoinRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let index = 0;
  while (index < text.length && text.charCodeAt(index) < RTL_FLOOR) index++;
  if (index === text.length) return ranges;

  let start = -1;
  let end = -1;
  let count = 0;
  const close = (): void => {
    if (start !== -1 && count >= 2) ranges.push([start, end]);
    start = -1;
    count = 0;
  };

  for (; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < RTL_FLOOR) {
      if (start !== -1 && !isRunNeutral(unit)) close();
      continue;
    }
    let codePoint = unit;
    let units = 1;
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (unit - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        units = 2;
      }
    }
    if (isRunTransparent(codePoint)) {
    } else if (isStrongRtl(codePoint)) {
      if (start !== -1 || !COMBINING_MARK.test(String.fromCodePoint(codePoint))) {
        if (start === -1) start = index;
        end = index + units;
        count++;
      }
    } else if (start !== -1) {
      close();
    }
    index += units - 1;
  }
  close();
  return ranges;
}

function containsRtl(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < RTL_FLOOR) continue;
    let codePoint = unit;
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (unit - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        index++;
      }
    }
    if (isStrongRtl(codePoint)) return true;
  }
  return false;
}

function shapeRtlRuns(terminal: Terminal, shaping: () => boolean): () => void {
  const write = terminal.write.bind(terminal);
  let joiner: number | null = null;
  let trailingHighSurrogate = '';

  const arm = (chunk: string | Uint8Array): void => {
    if (joiner !== null || typeof chunk !== 'string') return;
    const text = trailingHighSurrogate + chunk;
    const final = text.at(-1) ?? '';
    const unit = final.charCodeAt(0);
    trailingHighSurrogate = unit >= 0xd800 && unit <= 0xdbff ? final : '';
    if (!containsRtl(text)) return;
    trailingHighSurrogate = '';
    joiner = terminal.registerCharacterJoiner((row) => (shaping() ? rtlJoinRanges(row) : []));
    terminal.write = write;
  };

  terminal.write = (data: string | Uint8Array, callback?: () => void) => {
    arm(data);
    return write(data, callback);
  };

  return () => {
    terminal.write = write;
    if (joiner !== null) terminal.deregisterCharacterJoiner(joiner);
    joiner = null;
  };
}

interface WidthProvider {
  readonly version: string;
  wcwidth(codepoint: number): 0 | 1 | 2;
  charProperties(codepoint: number, preceding: number): number;
}

function widenZwjSequences(terminal: Terminal): () => void {
  const registered = (terminal as unknown as { _core?: { unicodeService?: { _providers?: Record<string, WidthProvider> } } })._core
    ?.unicodeService?._providers;
  const base = registered?.['11'];
  if (!base) return () => undefined;

  if (!terminal.unicode.versions.includes(ZWJ_VERSION)) terminal.unicode.register(zwjProvider(base));
  terminal.unicode.activeVersion = ZWJ_VERSION;

  return () => {
    terminal.unicode.activeVersion = '11';
  };
}

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const DISCRETE_PIXEL_DELTA_MIN = 50;
const LEGACY_DELTA_MIN = 100;
const LEGACY_DELTA_UNIT = 120;
const DEFAULT_CELL_HEIGHT = 16;
const ACCELERATED_GAIN = 1.6;
const BURST_FULL_INTERVAL_MS = 16;
const BURST_MAX_INTERVAL_MS = 45;
const BURST_MAX_BONUS_ROWS = 3;
const BURST_RAMP_EVENTS = 4;
const MOMENTUM_TAIL_DECAY = 0.85;
const COMPRESSED_MAX_ROWS = 6;
const BURST_MAX_ROWS = 9;
const SENSITIVITY_MIN = 1;
const SENSITIVITY_MAX = 10;
const SENSITIVITY_DEFAULT = 1;

export interface WheelInput {
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly timeStamp?: number;
  readonly wheelDelta?: number;
  readonly wheelDeltaY?: number;
}

export interface WheelMetrics {
  readonly cellHeight?: number;
  readonly rows?: number;
}

export interface WheelDistance {
  fastStreak: number;
  lastDistanceRows: number | null;
  lastInputAt: number | null;
  pendingDirection: -1 | 0 | 1;
  pendingRows: number;
}

export function newWheelDistance(): WheelDistance {
  return { fastStreak: 0, lastDistanceRows: null, lastInputAt: null, pendingDirection: 0, pendingRows: 0 };
}

function legacyDelta(event: WheelInput): number | null {
  if (typeof event.wheelDeltaY === 'number' && Number.isFinite(event.wheelDeltaY)) return event.wheelDeltaY;
  if (typeof event.wheelDelta === 'number' && Number.isFinite(event.wheelDelta)) return event.wheelDelta;
  return null;
}

function hasDiscreteLegacyDelta(event: WheelInput): boolean {
  const delta = legacyDelta(event);
  return delta !== null && Math.abs(delta) >= LEGACY_DELTA_MIN;
}

function isDiscrete(event: WheelInput): boolean {
  if ((event.deltaMode ?? DOM_DELTA_PIXEL) !== DOM_DELTA_PIXEL) return true;
  if (Math.abs(event.deltaY) >= DISCRETE_PIXEL_DELTA_MIN) return true;
  return hasDiscreteLegacyDelta(event);
}

function isTrackpad(event: WheelInput): boolean {
  return (event.deltaMode ?? DOM_DELTA_PIXEL) === DOM_DELTA_PIXEL && !hasDiscreteLegacyDelta(event);
}

function distanceRows(event: WheelInput, metrics: WheelMetrics): number {
  const deltaMode = event.deltaMode ?? DOM_DELTA_PIXEL;
  const deltaY = Math.abs(event.deltaY);
  const cellHeight =
    typeof metrics.cellHeight === 'number' && Number.isFinite(metrics.cellHeight) && metrics.cellHeight > 0
      ? metrics.cellHeight
      : DEFAULT_CELL_HEIGHT;
  const fromDelta =
    deltaMode === DOM_DELTA_LINE ? deltaY : deltaMode === DOM_DELTA_PAGE ? deltaY * Math.max(1, metrics.rows ?? 1) : deltaY / cellHeight;
  const legacy = legacyDelta(event);
  const fromLegacy = legacy === null ? 0 : Math.abs(legacy) / LEGACY_DELTA_UNIT;
  const rows = Math.max(fromDelta, fromLegacy);
  return isDiscrete(event) ? Math.max(1, rows) : rows;
}

function burstRows(event: WheelInput, state: WheelDistance, rows: number): number {
  const forget = (): number => {
    state.fastStreak = 0;
    state.lastDistanceRows = null;
    state.lastInputAt = null;
    return 0;
  };
  if ((event.deltaMode ?? DOM_DELTA_PIXEL) === DOM_DELTA_PIXEL && !hasDiscreteLegacyDelta(event)) return forget();
  const at = typeof event.timeStamp === 'number' && Number.isFinite(event.timeStamp) ? event.timeStamp : null;
  if (at === null) return forget();

  const elapsed = state.lastInputAt === null ? null : at - state.lastInputAt;
  const isMomentumTail = state.lastDistanceRows !== null && rows < state.lastDistanceRows * MOMENTUM_TAIL_DECAY;
  state.lastDistanceRows = rows;
  state.lastInputAt = at;
  if (isMomentumTail || elapsed === null || elapsed < 0 || elapsed > BURST_MAX_INTERVAL_MS) {
    state.fastStreak = 0;
    return 0;
  }

  const cadence =
    elapsed <= BURST_FULL_INTERVAL_MS ? 1 : (BURST_MAX_INTERVAL_MS - elapsed) / (BURST_MAX_INTERVAL_MS - BURST_FULL_INTERVAL_MS);
  state.fastStreak = Math.min(BURST_RAMP_EVENTS, state.fastStreak + 1);
  return BURST_MAX_BONUS_ROWS * cadence * (state.fastStreak / BURST_RAMP_EVENTS);
}

export function wheelSensitivity(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SENSITIVITY_DEFAULT;
  return Math.round(Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, value)));
}

export function wheelReportCount(event: WheelInput, sensitivity: number, state: WheelDistance, metrics: WheelMetrics = {}): number {
  const direction: -1 | 1 = event.deltaY < 0 ? -1 : 1;
  if (state.pendingDirection !== 0 && state.pendingDirection !== direction) {
    state.fastStreak = 0;
    state.lastDistanceRows = null;
    state.lastInputAt = null;
    state.pendingRows = 0;
  }
  state.pendingDirection = direction;

  const rows = distanceRows(event, metrics);
  if (isTrackpad(event)) {
    const total = state.pendingRows + rows;
    const reports = Math.trunc(total);
    state.pendingRows = total - reports;
    return reports;
  }

  const compressed = rows <= 1 ? rows : Math.min(COMPRESSED_MAX_ROWS, 1 + Math.log2(rows) * ACCELERATED_GAIN);
  const total = state.pendingRows + Math.min(BURST_MAX_ROWS, compressed + burstRows(event, state, rows)) * wheelSensitivity(sensitivity);
  const reports = Math.trunc(total);
  state.pendingRows = total - reports;
  return reports;
}

const MOUSE_REPORTING_CLASS = 'enable-mouse-events';
const REPLAYED = '__replayedWheelReport';

type ReplayedWheelEvent = WheelEvent & { [REPLAYED]?: true };

function lineReport(event: WheelEvent): WheelEvent {
  const clone: ReplayedWheelEvent = new WheelEvent(event.type, {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    deltaX: 0,
    deltaY: event.deltaY < 0 ? -1 : 1,
    deltaZ: 0,
    deltaMode: DOM_DELTA_LINE,
  });
  Object.defineProperty(clone, REPLAYED, { configurable: true, value: true });
  return clone;
}

function cellHeight(terminal: Terminal): number | undefined {
  const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen');
  const rect = screen?.getBoundingClientRect();
  if (!rect || rect.height <= 0 || terminal.rows <= 0) return undefined;
  return rect.height / terminal.rows;
}

function replayWheelReports(terminal: Terminal, sensitivity: () => number | undefined): () => void {
  const state = newWheelDistance();
  let live = true;
  let scheduled = false;
  let pending = 0;
  let pendingDirection: -1 | 0 | 1 = 0;
  let pendingEvent: WheelEvent | null = null;
  let pendingTarget: EventTarget | null = null;

  const drain = (): void => {
    scheduled = false;
    const target = pendingTarget;
    const event = pendingEvent;
    const reports = pending;
    pending = 0;
    pendingDirection = 0;
    pendingEvent = null;
    pendingTarget = null;
    if (!target || !event || reports <= 0) return;
    if (terminal.modes.mouseTrackingMode === 'none') return;
    for (let index = 0; index < reports; index++) target.dispatchEvent(lineReport(event));
  };

  terminal.attachCustomWheelEventHandler((event) => {
    const replayed = (event as ReplayedWheelEvent)[REPLAYED] === true;
    if (
      !live ||
      replayed ||
      terminal.modes.mouseTrackingMode === 'none' ||
      !terminal.element?.classList.contains(MOUSE_REPORTING_CLASS) ||
      event.deltaY === 0 ||
      event.shiftKey
    ) {
      return true;
    }
    const target = event.currentTarget instanceof EventTarget ? event.currentTarget : terminal.element;
    if (!target) return true;

    const count = wheelReportCount(event, wheelSensitivity(sensitivity()), state, {
      cellHeight: cellHeight(terminal),
      rows: terminal.rows,
    });
    if (count > 0) {
      const direction: -1 | 1 = event.deltaY < 0 ? -1 : 1;
      if (pendingDirection !== 0 && pendingDirection !== direction) pending = 0;
      pendingDirection = direction;
      pendingEvent = event;
      pendingTarget = target;
      pending += count;
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(drain);
      }
    }
    return false;
  });

  return () => {
    live = false;
  };
}

function hideCursorWhileTyping(terminal: Terminal, hide: () => boolean): () => void {
  const element = terminal.element;
  if (!element) return () => undefined;
  const show = (): void => {
    element.style.cursor = '';
  };
  const typed = terminal.onData(() => {
    if (!hide()) {
      show();
      return;
    }
    element.style.cursor = 'none';
  });
  element.addEventListener('mousemove', show);
  return () => {
    typed.dispose();
    element.removeEventListener('mousemove', show);
    show();
  };
}
