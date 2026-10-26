import { Terminal, type IBuffer, type IBufferCell, type IBufferLine } from '@xterm/headless';
import type { ByteOffset, TerminalGeometry } from '@runlith/executions/protocol/record';

export type CheckpointLink = { readonly token: string; readonly id: string | undefined; readonly uri: string };

export type ScreenCheckpoint = {
  readonly position: ByteOffset;
  readonly geometry: TerminalGeometry;
  readonly links: ReadonlyArray<CheckpointLink>;
  readonly bytes: ReadonlyArray<Uint8Array>;
};

type Charset = Readonly<Record<string, string>> | undefined;

type Pen = {
  readonly fg: number;
  readonly bg: number;
  readonly extended: { readonly underlineStyle: number; readonly underlineColor: number; readonly urlId: number };
  isBold(): number;
  isDim(): number;
  isItalic(): number;
  isBlink(): number;
  isInverse(): number;
  isInvisible(): number;
  isStrikethrough(): number;
  isOverline(): number;
  isProtected(): number;
  getFgColorMode(): number;
  getFgColor(): number;
  getBgColorMode(): number;
  getBgColor(): number;
  getUnderlineStyle(): number;
};

type Cell = IBufferCell & Pen;

type EngineBuffer = {
  readonly x: number;
  readonly y: number;
  readonly ybase: number;
  readonly scrollTop: number;
  readonly scrollBottom: number;
  readonly tabs: Readonly<Record<string, boolean | undefined>>;
  readonly savedX: number;
  readonly savedY: number;
  readonly savedCurAttrData: Pen;
  readonly savedCharsets: ReadonlyArray<Charset>;
  readonly savedGlevel: number;
  readonly savedOriginMode: boolean;
  readonly savedWraparoundMode: boolean;
};

type KittyKeyboard = {
  readonly flags: number;
  readonly mainFlags: number;
  readonly altFlags: number;
  readonly mainStack: ReadonlyArray<number>;
  readonly altStack: ReadonlyArray<number>;
};

type LinkData = { readonly id?: string; readonly uri: string };

type LinkEntry = { key?: string; data: LinkData; bytes: number };

type LinkService = {
  getLinkData(id: number): LinkData | undefined;
  readonly _dataByLinkId: ReadonlyMap<number, LinkEntry>;
  readonly _entriesWithId: Map<string, LinkEntry>;
  _getEntryIdKey(data: LinkData): string;
};

type Engine = {
  readonly _bufferService: {
    readonly buffers: { readonly normal: EngineBuffer; readonly alt: EngineBuffer };
    readonly dynamicStorage: { linkBytes: number };
  };
  readonly _charsetService: { readonly charsets: ReadonlyArray<Charset>; readonly glevel: number; readonly charset: Charset };
  readonly coreService: { readonly isCursorHidden: boolean; readonly kittyKeyboard: KittyKeyboard };
  readonly mouseStateService: { readonly activeEncoding: string };
  readonly _inputHandler: { readonly _curAttrData: Pen; selectCharset(designation: string): boolean };
  readonly _oscLinkService: LinkService;
  readonly optionsService: { readonly rawOptions: { readonly tabStopWidth: number; readonly convertEol: boolean } };
};

type Printed = { readonly column: number; readonly cell: Cell };

const CSI = '\u001b[';
const ST = '\u001b\\';
const LINK_CLOSE = `\u001b]8;;${ST}`;
const SLICE_CELLS = 16384;
const WIDE = '\u6f22';
const SAVED_LINK = 'tagma-checkpoint-saved';
const DESIGNATORS = ['(', ')', '*', '+'] as const;
const SHIFTS = ['\u000f', '\u000e', '\u001bn', '\u001bo'] as const;
const DESIGNATIONS = ['B', '0', 'A', '4', 'C', '5', 'R', 'Q', 'K', 'Y', 'E', '6', 'Z', 'H', '7', '='] as const;
const COLOR_MASK = 0x3000000;
const COLOR_DEFAULT = 0;
const COLOR_P16 = 0x1000000;
const COLOR_RGB = 0x3000000;
const ERASED_BG = 0x3ffffff;
const HAS_EXTENDED = 0x10000000;
const UNDERLINED = 0x10000000;
const MOUSE_PROTOCOLS: Readonly<Record<string, string>> = { x10: '?9h', vt200: '?1000h', drag: '?1002h', any: '?1003h' };
const MOUSE_ENCODINGS: Readonly<Record<string, string>> = { SGR: '?1006h', SGR_PIXELS: '?1016h' };

const engineOf = (terminal: Terminal): Engine => (terminal as unknown as { readonly _core: Engine })._core;

let designated: ReadonlyMap<Charset, string> | undefined;

const finals = (): ReadonlyMap<Charset, string> => {
  if (designated !== undefined) return designated;
  const probe = new Terminal({ allowProposedApi: true });
  const engine = engineOf(probe);
  const found = new Map<Charset, string>();
  for (const final of DESIGNATIONS) {
    engine._inputHandler.selectCharset(`(${final}`);
    const charset = engine._charsetService.charsets[0];
    if (!found.has(charset)) found.set(charset, final);
  }
  probe.dispose();
  designated = found;
  return found;
};

const designationText = (charsets: ReadonlyArray<Charset>, glevel: number): string => {
  const known = finals();
  let text = '';
  for (const [slot, designator] of DESIGNATORS.entries()) {
    if (slot >= charsets.length) break;
    const final = known.get(charsets[slot]);
    if (final === undefined) throw new Error(`G${slot} holds a character set this engine build designates by no final`);
    text += `\u001b${designator}${final}`;
  }
  return text + (SHIFTS[glevel] ?? SHIFTS[0]);
};

const plain = (charsets: ReadonlyArray<Charset>): ReadonlyArray<Charset> => charsets.map(() => undefined);

const inverses = new WeakMap<object, ReadonlyMap<string, string>>();

const unmapped = (text: string, charset: Charset): string => {
  if (charset === undefined) return text;
  let inverse = inverses.get(charset);
  if (inverse === undefined) {
    const built = new Map<string, string>();
    for (const [input, glyph] of Object.entries(charset)) if (!built.has(glyph)) built.set(glyph, input);
    inverse = built;
    inverses.set(charset, built);
  }
  let input = '';
  for (const glyph of text) input += inverse.get(glyph) ?? glyph;
  return input;
};

const colorParams = (mode: number, color: number, base: number, bright: number, extended: number): ReadonlyArray<number> => {
  if (mode === COLOR_DEFAULT) return [];
  if (mode === COLOR_RGB) return [extended, 2, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff];
  if (mode === COLOR_P16) return [color < 8 ? base + color : bright + color - 8];
  return [extended, 5, color];
};

const underlineColor = (color: number): string | undefined => {
  if (color === -1 || (color & COLOR_MASK) === COLOR_DEFAULT) return undefined;
  if ((color & COLOR_MASK) !== COLOR_RGB) return `58:5:${color & 0xff}`;
  return `58:2::${(color >>> 16) & 0xff}:${(color >>> 8) & 0xff}:${color & 0xff}`;
};

const sgrText = (pen: Pen): string =>
  penText(pen, pen.getUnderlineStyle(), (pen.bg & HAS_EXTENDED) === 0 ? undefined : underlineColor(pen.extended.underlineColor));

const liveText = (pen: Pen): string => penText(pen, pen.getUnderlineStyle(), underlineColor(pen.extended.underlineColor));

const savedPenText = (pen: Pen): string => penText(pen, (pen.fg & UNDERLINED) === 0 ? 0 : 1, undefined);

const penText = (pen: Pen, style: number, underline: string | undefined): string => {
  const params: Array<number | string> = [0];
  if (pen.isBold()) params.push(1);
  if (pen.isDim()) params.push(2);
  if (pen.isItalic()) params.push(3);
  if (style > 0) params.push(style === 1 ? 4 : `4:${style}`);
  if (pen.isBlink()) params.push(5);
  if (pen.isInverse()) params.push(7);
  if (pen.isInvisible()) params.push(8);
  if (pen.isStrikethrough()) params.push(9);
  if (pen.isOverline()) params.push(53);
  params.push(...colorParams(pen.getFgColorMode(), pen.getFgColor(), 30, 90, 38));
  params.push(...colorParams(pen.getBgColorMode(), pen.getBgColor(), 40, 100, 48));
  if (underline !== undefined) params.push(underline);
  return `${CSI}${params.join(';')}m${CSI}${pen.isProtected() ? 1 : 0}"q`;
};

const linkOf = (pen: Pen): number => ((pen.bg & HAS_EXTENDED) === 0 ? 0 : pen.extended.urlId);

class LinkTokens {
  private readonly tokens = new Map<number, LinkData>();
  readonly table: CheckpointLink[] = [];

  constructor(
    private readonly service: LinkService,
    private readonly nonce: string,
  ) {}

  text(pen: Pen): string {
    const id = linkOf(pen);
    if (id === 0) return LINK_CLOSE;
    let data = this.tokens.get(id);
    if (data === undefined) {
      const original = this.service.getLinkData(id);
      if (original === undefined) return LINK_CLOSE;
      const token = `tagma-checkpoint-${this.nonce}-${this.table.length}`;
      data = { id: original.id ?? token, uri: token };
      this.table.push({ token, id: original.id, uri: original.uri });
      this.tokens.set(id, data);
    }
    return `\u001b]8;id=${data.id};${data.uri}${ST}`;
  }
}

const charged = (entry: LinkEntry): number => 2 * entry.data.uri.length + (entry.key === undefined ? 0 : 2 * entry.key.length);

export const relink = (terminal: Terminal, links: ReadonlyArray<CheckpointLink>): void => {
  if (links.length === 0) return;
  const engine = engineOf(terminal);
  const service = engine._oscLinkService;
  const storage = engine._bufferService.dynamicStorage;
  const byToken = new Map(links.map((link) => [link.token, link]));
  for (const entry of [...service._dataByLinkId.values()]) {
    const link = byToken.get(entry.data.uri);
    if (link === undefined) continue;
    const before = charged(entry);
    if (entry.key !== undefined) service._entriesWithId.delete(entry.key);
    entry.data = link.id === undefined ? { uri: link.uri } : { id: link.id, uri: link.uri };
    entry.key = link.id === undefined ? undefined : service._getEntryIdKey(entry.data);
    if (entry.key !== undefined) service._entriesWithId.set(entry.key, entry);
    const delta = charged(entry) - before;
    entry.bytes += delta;
    storage.linkBytes += delta;
  }
};

const LINK_OPEN = /^\u001b\]8;([^;\u001b]*);([^\u001b]*)$/u;
const LINK_PREFIX = '\u001b]8;';
const SLICE_BYTES = 16384;

export function* withLinks(checkpoint: ScreenCheckpoint): Generator<string | undefined> {
  const uris = new Map<string, string>();
  let work = 0;
  for (const link of checkpoint.links) {
    uris.set(link.token, link.uri);
    work += link.token.length;
    if (work >= SLICE_BYTES) {
      yield undefined;
      work = 0;
    }
  }
  const decoder = new TextDecoder();
  let prefix = '';
  let opened: string[] | undefined;
  let ending = false;
  for (const piece of checkpoint.bytes) {
    for (let at = 0; at < piece.length; at += SLICE_BYTES) {
      const text = decoder.decode(piece.subarray(at, at + SLICE_BYTES), { stream: true });
      if (uris.size === 0) {
        yield text;
        yield undefined;
        continue;
      }
      for (let index = 0; index < text.length;) {
        if (ending) {
          const carried = opened?.join('') ?? '';
          const match = text[index] === '\\' ? LINK_OPEN.exec(carried) : null;
          if (match === null) yield carried;
          else {
            yield `${LINK_PREFIX}${match[1]};`;
            yield uris.get(match[2]!) ?? match[2]!;
            yield ST;
            index += 1;
          }
          opened = undefined;
          ending = false;
          if (match === null) prefix = '\u001b';
        } else if (opened !== undefined) {
          const end = text.indexOf('\u001b', index);
          opened.push(text.slice(index, end < 0 ? text.length : end));
          index = end < 0 ? text.length : end + 1;
          ending = end >= 0;
        } else if (prefix !== '') {
          if (text[index] === LINK_PREFIX[prefix.length]) {
            prefix += text[index++];
            if (prefix === LINK_PREFIX) {
              opened = [prefix];
              prefix = '';
            }
          } else {
            yield prefix;
            prefix = '';
          }
        } else {
          const end = text.indexOf('\u001b', index);
          yield text.slice(index, end < 0 ? text.length : end);
          index = end < 0 ? text.length : end + 1;
          if (end >= 0) prefix = '\u001b';
        }
      }
      yield undefined;
    }
  }
  if (opened !== undefined) yield opened.join('') + (ending ? '\u001b' : '');
  yield prefix + decoder.decode();
}

const kittyText = (stack: ReadonlyArray<number>, flags: number): string => {
  if (stack.length === 0 && flags === 0) return '';
  const [first, ...rest] = [...stack, flags];
  return `${CSI}=${first};1u${rest.map((value) => `${CSI}>${value}u`).join('')}`;
};

const cursorText = (top: number, row: number, column: number, origin: boolean): string =>
  `${CSI}${origin ? Math.max(row - top, 0) + 1 : row + 1};${column + 1}H`;

const penned = (cell: Cell): boolean => cell.getChars() === '' && (cell.fg !== 0 || (cell.bg & ~ERASED_BG) !== 0);

class Rows {
  private column = 0;
  private fg = 0;
  private bg = 0;
  private style = 0;
  private color = -1;
  private link = 0;
  private junkFrom = 0;
  private junkTo = 0;
  private readonly scratch: Cell;
  text = '';

  constructor(
    private readonly cols: number,
    private readonly tokens: LinkTokens,
    lines: IBuffer,
  ) {
    this.scratch = lines.getNullCell() as Cell;
  }

  row(line: IBufferLine, next: IBufferLine | undefined): void {
    const cell = this.scratch;
    const continued = next?.isWrapped === true;
    const tail = continued ? this.cols : this.pennedTail(line);
    let wrapped = false;
    for (let x = 0; x < this.cols;) {
      line.getCell(x, cell);
      const chars = cell.getChars();
      if (chars !== '') {
        const width = cell.getWidth();
        this.at(x, width === 0);
        this.pen(cell);
        this.text += chars;
        this.column = x + Math.max(width, 1);
        x += Math.max(width, 1);
        continue;
      }
      if (x >= tail) break;
      if (continued && x === this.cols - 1) {
        this.at(x, false);
        this.pen(cell);
        this.text += WIDE;
        this.column = 2;
        this.junk(0, (cell.bg & ERASED_BG) === 0 ? 2 : this.cols, true);
        wrapped = true;
        break;
      }
      if (penned(cell) && x + 1 < tail) {
        this.at(x, false);
        this.pen(cell);
        this.text += `${WIDE}${CSI}${x + 2}G `;
        this.column = x + 2;
        this.junk(x + 1, x + 2, false);
        x += 1;
        continue;
      }
      let run = 1;
      const erased = cell.bg & ERASED_BG;
      while (x + run < tail && !(continued && x + run === this.cols - 1)) {
        line.getCell(x + run, cell);
        if (cell.getChars() !== '' || penned(cell) || (cell.bg & ERASED_BG) !== erased) break;
        run += 1;
      }
      if (erased !== 0 || (x < this.junkTo && x + run > this.junkFrom)) {
        line.getCell(x, cell);
        this.at(x, false);
        this.pen(cell);
        this.text += `${CSI}${run}X`;
      }
      x += run;
    }
    if (wrapped || next === undefined) return;
    if (!continued) {
      this.plain();
      this.text += '\r\n';
      this.column = 0;
      this.junk(0, 0, true);
      return;
    }
    next.getCell(0, this.scratch);
    if (this.scratch.getChars() !== '' && this.scratch.getWidth() > 0) {
      this.column = 0;
      this.junk(0, (this.scratch.bg & ERASED_BG) === 0 ? 0 : this.cols, true);
      return;
    }
    this.plain();
    this.text += 'x';
    this.column = 1;
    this.junk(0, 1, true);
  }

  private pennedTail(line: IBufferLine): number {
    const cell = this.scratch;
    let tail = this.cols;
    while (tail > 1 && line.getCell(tail - 1, cell) !== undefined && penned(cell)) tail -= 1;
    for (let x = this.cols - 1; x >= tail; x -= 1) {
      line.getCell(x, cell);
      this.at(x - 1, false);
      this.pen(cell);
      this.text += `${WIDE}${CSI}${x}G `;
      this.column = x;
    }
    if (tail < this.cols) this.junk(tail - 1, tail, false);
    return tail;
  }

  private junk(from: number, to: number, fresh: boolean): void {
    if (fresh || this.junkTo <= this.junkFrom) {
      this.junkFrom = from;
      this.junkTo = to;
      return;
    }
    this.junkFrom = Math.min(this.junkFrom, from);
    this.junkTo = Math.max(this.junkTo, to);
  }

  end(): void {
    this.plain();
  }

  private at(x: number, force: boolean): void {
    if (!force && this.column === x) return;
    this.text += `${CSI}${x + 1}G`;
    this.column = x;
  }

  private pen(cell: Cell): void {
    const extended = (cell.bg & HAS_EXTENDED) !== 0;
    const style = extended ? cell.extended.underlineStyle : 0;
    const color = extended ? cell.extended.underlineColor : -1;
    if (cell.fg !== this.fg || cell.bg !== this.bg || style !== this.style || color !== this.color) {
      this.text += sgrText(cell);
      this.fg = cell.fg;
      this.bg = cell.bg;
      this.style = style;
      this.color = color;
    }
    const link = linkOf(cell);
    if (link !== this.link) {
      this.text += this.tokens.text(cell);
      this.link = link;
    }
  }

  private plain(): void {
    if (this.fg !== 0 || this.bg !== 0 || this.style !== 0 || this.color !== -1) {
      this.text += `${CSI}0m${CSI}0"q`;
      this.fg = 0;
      this.bg = 0;
      this.style = 0;
      this.color = -1;
    }
    if (this.link !== 0) {
      this.text += LINK_CLOSE;
      this.link = 0;
    }
  }
}

function* contentPieces(terminal: Terminal, tokens: LinkTokens, lines: IBuffer, from = 0): Generator<string> {
  const rows = new Rows(terminal.cols, tokens, lines);
  let cells = 0;
  for (let row = from; row < lines.length; row += 1) {
    const line = lines.getLine(row);
    if (line === undefined) continue;
    rows.row(line, row + 1 < lines.length ? lines.getLine(row + 1) : undefined);
    cells += terminal.cols;
    if (cells >= SLICE_CELLS) {
      yield rows.text;
      rows.text = '';
      cells = 0;
    }
  }
  rows.end();
  yield rows.text;
}

const tabText = (terminal: Terminal, engine: Engine, buffer: EngineBuffer): string => {
  const width = engine.optionsService.rawOptions.tabStopWidth;
  const stops: number[] = [];
  for (let column = 0; column < terminal.cols; column += 1) if (buffer.tabs[column] === true) stops.push(column);
  if (stops.length === Math.ceil(terminal.cols / width) && stops.every((column, index) => column === index * width)) return '';
  return `${CSI}3g${stops.map((column) => `${CSI}${column + 1}G\u001bH`).join('')}`;
};

const savedText = (terminal: Terminal, buffer: EngineBuffer): string => {
  const row = Math.min(Math.max(buffer.savedY - buffer.ybase, 0), terminal.rows - 1);
  const column = Math.min(buffer.savedX, terminal.cols - 1);
  const pen = buffer.savedCurAttrData;
  const fresh = row === 0 && column === 0 && pen.fg === 0 && pen.bg === 0 && buffer.savedCharsets.length === 0;
  if (fresh && buffer.savedGlevel === 0 && !buffer.savedOriginMode && buffer.savedWraparoundMode) return '';
  let text = buffer.savedOriginMode ? `${CSI}?6h` : '';
  text += cursorText(0, row, column, buffer.savedOriginMode);
  const linked = (pen.bg & HAS_EXTENDED) !== 0 && (pen.fg & UNDERLINED) === 0;
  text += savedPenText(pen) + designationText(buffer.savedCharsets, buffer.savedGlevel);
  if (linked) text += `\u001b]8;;${SAVED_LINK}${ST}`;
  if (!buffer.savedWraparoundMode) text += `${CSI}?7l`;
  text += `\u001b7${linked ? LINK_CLOSE : ''}${CSI}0m${CSI}0"q${designationText(plain(buffer.savedCharsets), 0)}`;
  if (buffer.savedOriginMode) text += `${CSI}?6l`;
  return buffer.savedWraparoundMode ? text : `${text}${CSI}?7h`;
};

const bufferText = (terminal: Terminal, engine: Engine, buffer: EngineBuffer): string => {
  let text = tabText(terminal, engine, buffer) + savedText(terminal, buffer);
  if (buffer.scrollTop !== 0 || buffer.scrollBottom !== terminal.rows - 1) {
    text += `${CSI}${buffer.scrollTop + 1};${buffer.scrollBottom + 1}r`;
  }
  return text;
};

const modeText = (terminal: Terminal, engine: Engine): string => {
  const modes = terminal.modes;
  let text = '';
  if (modes.applicationCursorKeysMode) text += `${CSI}?1h`;
  if (modes.applicationKeypadMode) text += `${CSI}?66h`;
  if (modes.bracketedPasteMode) text += `${CSI}?2004h`;
  if (modes.sendFocusMode) text += `${CSI}?1004h`;
  if (modes.reverseWraparoundMode) text += `${CSI}?45h`;
  const protocol = MOUSE_PROTOCOLS[modes.mouseTrackingMode];
  if (protocol !== undefined) text += `${CSI}${protocol}`;
  const encoding = MOUSE_ENCODINGS[engine.mouseStateService.activeEncoding];
  if (encoding !== undefined) text += `${CSI}${encoding}`;
  if (engine.coreService.isCursorHidden) text += `${CSI}?25l`;
  if (engine.optionsService.rawOptions.convertEol) text += `${CSI}20h`;
  if (modes.synchronizedOutputMode) text += `${CSI}?2026h`;
  if (!modes.wraparoundMode) text += `${CSI}?7l`;
  if (modes.originMode) text += `${CSI}?6h`;
  return text;
};

const lastPrinted = (terminal: Terminal, buffer: EngineBuffer, printed: boolean): Printed | undefined => {
  if (buffer.x === 0 || (!printed && buffer.x < terminal.cols)) return undefined;
  const line = terminal.buffer.active.getLine(buffer.ybase + buffer.y);
  if (line === undefined) return undefined;
  let column = Math.min(buffer.x, terminal.cols) - 1;
  if (column > 0 && line.getCell(column)?.getWidth() === 0 && line.getCell(column - 1)?.getWidth() === 2) column -= 1;
  const cell = line.getCell(column) as Cell | undefined;
  if (cell === undefined) return undefined;
  if (cell.getChars() !== '') return { column, cell };
  for (let x = 0; x < terminal.cols; x += 1) if (line.getCell(x)?.getChars() !== '') return undefined;
  return { column, cell };
};

const finalText = (terminal: Terminal, engine: Engine, tokens: LinkTokens, buffer: EngineBuffer): string => {
  const parse = terminal.parseState;
  if (parse === undefined) throw new Error('the engine build reads no parse state');
  const origin = terminal.modes.originMode;
  const pen = engine._inputHandler._curAttrData;
  const charsets = engine._charsetService;
  const current = liveText(pen) + designationText(charsets.charsets, charsets.glevel) + tokens.text(pen);
  const insert = terminal.modes.insertMode ? `${CSI}4h` : '';
  const text = modeText(terminal, engine);
  const last = lastPrinted(terminal, buffer, parse.printed);
  if (last === undefined) {
    return text + cursorText(buffer.scrollTop, buffer.y, Math.min(buffer.x, terminal.cols - 1), origin) + current + insert;
  }
  const placed = text + cursorText(buffer.scrollTop, buffer.y, last.column, origin);
  const chars = last.cell.getChars();
  if (chars === '') return `${placed}${sgrText(last.cell)} ${CSI}1K${current}${insert}`;
  const room = insert === '' ? '' : `${insert}${CSI}${Math.max(last.cell.getWidth(), 1)}P`;
  if (parse.printed) return placed + current + room + unmapped(chars, charsets.charset);
  const ascii = designationText(plain(charsets.charsets), 0);
  return placed + sgrText(last.cell) + ascii + tokens.text(last.cell) + room + chars + current;
};

export function* checkpointPieces(
  terminal: Terminal,
  appearance: string,
  nonce: string,
  history = Number.POSITIVE_INFINITY,
): Generator<string, ReadonlyArray<CheckpointLink>> {
  const engine = engineOf(terminal);
  const tokens = new LinkTokens(engine._oscLinkService, nonce);
  const { normal, alt } = engine._bufferService.buffers;
  const kitty = engine.coreService.kittyKeyboard;
  const alternate = terminal.buffer.active.type === 'alternate';
  if (alternate) yield appearance + kittyText(kitty.mainStack, kitty.mainFlags);
  else {
    const away = kittyText(kitty.altStack, kitty.altFlags) + savedText(terminal, alt);
    yield appearance + (away === '' ? '' : `${CSI}?1047h${away}${CSI}?1047l${CSI}H`) + kittyText(kitty.mainStack, kitty.flags);
  }
  const lines = terminal.buffer.normal;
  yield* contentPieces(terminal, tokens, lines, Math.max(0, lines.length - terminal.rows - history));
  yield bufferText(terminal, engine, normal);
  if (alternate) {
    yield `${CSI}?1047h${kittyText(kitty.altStack, kitty.flags)}${CSI}H`;
    yield* contentPieces(terminal, tokens, terminal.buffer.alternate);
    yield bufferText(terminal, engine, alt);
  }
  yield finalText(terminal, engine, tokens, alternate ? alt : normal);
  return tokens.table;
}
