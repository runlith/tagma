import type { IBuffer, IBufferCell, IBufferLine, IMarker, Terminal } from '@xterm/headless';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type {
  BufferKind,
  CellStyle,
  ColorSlot,
  CursorPosition,
  ScreenCell,
  ScreenGeometry,
  ScreenRow,
  ScreenTextRow,
  UnderlineStyle,
} from '@runlith/executions/protocol/presentation';

export type Copied = {
  readonly spent: number;
  readonly buffer: BufferKind;
  readonly geometry: ScreenGeometry;
  readonly rows: ReadonlyArray<ScreenRow>;
  readonly cursor: CursorPosition;
  readonly fresh: number;
};

export type CopiedText = {
  readonly buffer: BufferKind;
  readonly geometry: ScreenGeometry;
  readonly rows: ReadonlyArray<ScreenTextRow>;
  readonly cursor: CursorPosition;
};

type Carried = { readonly row: ScreenRow; readonly cost: number };

type Kept = {
  readonly buffer: BufferKind;
  readonly layout: number;
  readonly columns: number;
  readonly carried: ReadonlyArray<Carried>;
  readonly marker: IMarker | undefined;
  readonly marked: number;
  readonly sealed: number;
};

type Recalled = { readonly shift: number; readonly sealed: number };

const UNTRUSTED: Recalled = { shift: 0, sealed: -1 };

const UNDERLINE: ReadonlyArray<UnderlineStyle> = ['none', 'single', 'double', 'curly', 'dotted', 'dashed'];

const encodedBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const LONGEST_SLOT: ColorSlot = ([{ _tag: 'Rgb', value: 0xffffff }, { _tag: 'Palette', index: 255 }, { _tag: 'Default' }] as const).reduce(
  (widest, slot) => (encodedBytes(slot) > encodedBytes(widest) ? slot : widest),
);

const LONGEST_UNDERLINE = (['none', 'single', 'double', 'curly', 'dotted', 'dashed'] as const).reduce((widest, style) =>
  style.length > widest.length ? style : widest,
);

const WIDEST_CELL: ScreenCell = {
  chars: '',
  width: 2,
  style: {
    foreground: LONGEST_SLOT,
    background: LONGEST_SLOT,
    underlineColor: LONGEST_SLOT,
    underline: LONGEST_UNDERLINE,
    bold: false,
    dim: false,
    italic: false,
    blink: false,
    inverse: false,
    invisible: false,
    strikethrough: false,
    overline: false,
  },
};

const CELL_SKELETON = encodedBytes(WIDEST_CELL);
const ROW_SKELETON = encodedBytes({ line: Number.MAX_SAFE_INTEGER, wrapped: false, cells: [] });
const CELL_SEPARATOR = 1;

export const FRAME_ENVELOPE = encodedBytes({
  _tag: 'ScreenPatch',
  provenance: {
    ref: { installation: 'x'.repeat(64), execution: 'x'.repeat(64), incarnation: Number.MAX_SAFE_INTEGER },
    base: Number.MAX_SAFE_INTEGER,
    revision: Number.MAX_SAFE_INTEGER,
    parsedThrough: '9'.repeat(20),
  },
  buffer: 'alternate',
  geometry: {
    rows: Number.MAX_SAFE_INTEGER,
    columns: Number.MAX_SAFE_INTEGER,
    firstLine: Number.MAX_SAFE_INTEGER,
    viewportLine: Number.MAX_SAFE_INTEGER,
  },
  rows: [],
  cursor: { line: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER },
  appearance: {
    colors: {
      palette: Array.from({ length: 256 }, () => 0xffffff),
      foreground: 0xffffff,
      background: 0xffffff,
      cursor: 0xffffff,
    },
    cursor: { visible: false, style: 'underline', blink: false },
    title: '',
  },
  input: {
    _tag: 'Available',
    revision: Number.MAX_SAFE_INTEGER,
    profile: 'xterm-256color-unicode11',
    encoding: 'utf-8',
    terminal: 'xterm-256color',
    unicodeVersion: '11',
    applicationCursor: false,
    applicationKeypad: false,
    bracketedPaste: false,
    sendFocus: false,
    mouseTracking: (['none', 'x10', 'vt200', 'drag', 'any'] as const).reduce((widest, mode) =>
      mode.length > widest.length ? mode : widest,
    ),
    mouseEncoding: 'sgr-pixels',
    alternateScreen: false,
    kittyKeyboardFlags: 31,
  },
});

export const stringBytes = (value: string): number => {
  let bytes = 2;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point === 0x22 || point === 0x5c) bytes += 2;
    else if (point < 0x20) bytes += point === 0x08 || point === 0x09 || point === 0x0a || point === 0x0c || point === 0x0d ? 2 : 6;
    else if (point < 0x80) bytes += 1;
    else if (point < 0x800) bytes += 2;
    else if (point >= 0xd800 && point <= 0xdfff) bytes += 6;
    else if (point < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
};

const rowCost = (cells: ReadonlyArray<ScreenCell>): number => {
  let cost = ROW_SKELETON;
  for (const cell of cells) cost += CELL_SKELETON + CELL_SEPARATOR + stringBytes(cell.chars);
  return cost;
};

export class ScreenMirror {
  private kept: Kept | undefined;
  private scratch: IBufferCell | undefined;
  private readonly styles = new Map<number, Map<number, CellStyle>>();
  private pooled = 0;
  private lastOuter = -1;
  private lastInner = -1;
  private lastStyle: CellStyle = PLAIN;

  constructor(private readonly limits: ExecutionLimits) {}

  take(engine: Terminal, layout: number): Copied | 'oversized' {
    const buffer = engine.buffer.active;
    const columns = engine.cols;
    const held = Math.min(buffer.length, this.limits.geometry.scrollbackRows + engine.rows);
    const first = Math.max(0, buffer.length - held);
    const recalled = this.recall(buffer.type, layout, columns, buffer.baseY);
    const kept = this.kept?.buffer === buffer.type ? this.kept.carried : undefined;
    const carried: Carried[] = [];
    let spent = 0;
    let fresh = 0;
    let firstLine = first;
    for (let line = buffer.length - 1; line >= first; line -= 1) {
      const prior = kept === undefined ? undefined : at(kept, line + recalled.shift);
      let next: Carried;
      if (line <= recalled.sealed && line > engine.rows && prior !== undefined) {
        next = prior.row.line === line ? prior : { row: { line, wrapped: prior.row.wrapped, cells: prior.row.cells }, cost: prior.cost };
      } else {
        const source = buffer.getLine(line);
        if (source === undefined) continue;
        next = this.read(source, line, columns, prior);
        fresh += 1;
      }
      if (spent + next.cost + FRAME_ENVELOPE > this.limits.frame.bytes) {
        if (line >= buffer.baseY) return 'oversized';
        break;
      }
      spent += next.cost;
      carried.push(next);
      firstLine = line;
    }
    carried.reverse();
    this.remember(engine, buffer, layout, columns, carried, recalled.sealed >= 0);
    return {
      spent,
      buffer: buffer.type,
      geometry: {
        rows: engine.rows,
        columns,
        firstLine,
        viewportLine: buffer.baseY,
      },
      rows: carried.map((entry) => entry.row),
      cursor: { line: buffer.baseY + buffer.cursorY, column: buffer.cursorX },
      fresh,
    };
  }

  release(): void {
    this.kept?.marker?.dispose();
    this.kept = undefined;
  }

  private recall(buffer: BufferKind, layout: number, columns: number, viewportLine: number): Recalled {
    const kept = this.kept;
    const marker = kept?.marker;
    if (
      kept === undefined ||
      buffer !== 'normal' ||
      kept.buffer !== 'normal' ||
      kept.layout !== layout ||
      kept.columns !== columns ||
      marker === undefined ||
      marker.isDisposed
    ) {
      return UNTRUSTED;
    }
    const shift = kept.marked - marker.line;
    const sealed = kept.sealed - shift;
    if (shift < 0 || sealed < 0 || sealed >= viewportLine) return UNTRUSTED;
    return { shift, sealed };
  }

  private remember(
    engine: Terminal,
    buffer: IBuffer,
    layout: number,
    columns: number,
    carried: ReadonlyArray<Carried>,
    trusted: boolean,
  ): void {
    const history = buffer.type === 'normal' ? buffer.baseY : 0;
    let marker = this.kept?.marker;
    if (marker !== undefined && (history === 0 || !trusted || marker.isDisposed)) {
      marker.dispose();
      marker = undefined;
    }
    if (history > 0 && marker === undefined) {
      const placed = engine.registerMarker(-1 - buffer.cursorY);
      if (placed.line === history - 1) marker = placed;
      else placed.dispose();
    }
    this.kept = {
      buffer: buffer.type,
      layout,
      columns,
      carried,
      marker,
      marked: marker === undefined ? -1 : marker.line,
      sealed: marker === undefined ? -1 : history - 1,
    };
  }

  private read(source: IBufferLine, line: number, columns: number, prior: Carried | undefined): Carried {
    const known = prior?.row.cells;
    let cells: ScreenCell[] | undefined;
    let count = 0;
    for (let column = 0; column < columns; column += 1) {
      const cell = source.getCell(column, this.scratch);
      if (cell === undefined) break;
      this.scratch = cell;
      const chars = cell.getChars();
      const width = cell.getWidth();
      const style = this.styleOf(cell);
      const held = known?.[column];
      const same = held !== undefined && held.chars === chars && held.width === width && sameStyle(held.style, style) ? held : undefined;
      count += 1;
      if (cells === undefined) {
        if (same !== undefined) continue;
        cells = known === undefined ? [] : known.slice(0, column);
      }
      cells.push(same ?? { chars, width, style });
    }
    const wrapped = source.isWrapped;
    if (cells === undefined) {
      if (prior !== undefined && known !== undefined && known.length === count) {
        if (prior.row.line === line && prior.row.wrapped === wrapped) return prior;
        return { row: { line, wrapped, cells: known }, cost: prior.cost };
      }
      cells = known === undefined ? [] : known.slice(0, count);
    }
    return { row: { line, wrapped, cells }, cost: rowCost(cells) };
  }

  private styleOf(cell: IBufferCell): CellStyle {
    if (cell.isAttributeDefault()) return PLAIN;
    const foreground = slotKey(cell.isFgDefault(), cell.isFgPalette(), cell.getFgColor());
    const background = slotKey(cell.isBgDefault(), cell.isBgPalette(), cell.getBgColor());
    const underlineColor = slotKey(cell.isUnderlineColorDefault(), cell.isUnderlineColorPalette(), cell.getUnderlineColor());
    if (foreground < 0 || background < 0 || underlineColor < 0) return styleOf(cell);
    const outer = foreground * SLOT_KEYS + background;
    const inner = (underlineColor * 8 + underlineIndex(cell.getUnderlineStyle())) * 0x100 + flagsOf(cell);
    if (outer === this.lastOuter && inner === this.lastInner) return this.lastStyle;
    let bucket = this.styles.get(outer);
    let style = bucket?.get(inner);
    if (style === undefined) {
      style = styleOf(cell);
      if (this.pooled >= STYLES_HELD) {
        this.styles.clear();
        this.pooled = 0;
        bucket = undefined;
      }
      if (bucket === undefined) {
        bucket = new Map<number, CellStyle>();
        this.styles.set(outer, bucket);
      }
      bucket.set(inner, style);
      this.pooled += 1;
    }
    this.lastOuter = outer;
    this.lastInner = inner;
    this.lastStyle = style;
    return style;
  }
}

const at = (carried: ReadonlyArray<Carried>, line: number): Carried | undefined => {
  const head = carried[0];
  if (head === undefined) return undefined;
  const entry = carried[line - head.row.line];
  return entry !== undefined && entry.row.line === line ? entry : undefined;
};

const PLAIN: CellStyle = {
  foreground: { _tag: 'Default' },
  background: { _tag: 'Default' },
  underlineColor: { _tag: 'Default' },
  underline: 'none',
  bold: false,
  dim: false,
  italic: false,
  blink: false,
  inverse: false,
  invisible: false,
  strikethrough: false,
  overline: false,
};

const STYLES_HELD = 4096;
const SLOT_KEYS = 0x2000000;

const slotKey = (isDefault: boolean, isPalette: boolean, color: number): number => {
  if (isDefault) return 0;
  if (isPalette) return Number.isInteger(color) && color >= 0 && color <= 0xff ? 1 + color : -1;
  return Number.isInteger(color) && color >= 0 && color <= 0xffffff ? 0x101 + color : -1;
};

const underlineIndex = (raw: number): number => (Number.isInteger(raw) && raw >= 0 && raw < UNDERLINE.length ? raw : 0);

const flagsOf = (cell: IBufferCell): number =>
  (cell.isBold() !== 0 ? 1 : 0) |
  (cell.isDim() !== 0 ? 2 : 0) |
  (cell.isItalic() !== 0 ? 4 : 0) |
  (cell.isBlink() !== 0 ? 8 : 0) |
  (cell.isInverse() !== 0 ? 16 : 0) |
  (cell.isInvisible() !== 0 ? 32 : 0) |
  (cell.isStrikethrough() !== 0 ? 64 : 0) |
  (cell.isOverline() !== 0 ? 128 : 0);

export const sameStyle = (a: CellStyle, b: CellStyle): boolean =>
  a === b ||
  (a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.blink === b.blink &&
    a.inverse === b.inverse &&
    a.invisible === b.invisible &&
    a.strikethrough === b.strikethrough &&
    a.overline === b.overline &&
    a.underline === b.underline &&
    sameSlot(a.foreground, b.foreground) &&
    sameSlot(a.background, b.background) &&
    sameSlot(a.underlineColor, b.underlineColor));

const sameSlot = (a: ColorSlot, b: ColorSlot): boolean => {
  if (a._tag !== b._tag) return false;
  if (a._tag === 'Palette' && b._tag === 'Palette') return a.index === b.index;
  if (a._tag === 'Rgb' && b._tag === 'Rgb') return a.value === b.value;
  return true;
};

export const copyText = (engine: Terminal, scrollback: number): CopiedText => {
  const buffer = engine.buffer.active;
  const columns = engine.cols;
  const held = Math.min(buffer.length, engine.rows + Math.max(0, scrollback));
  const first = Math.max(0, buffer.length - held);
  const rows: ScreenTextRow[] = [];
  let carried = first;
  for (let line = buffer.length - 1; line >= first; line -= 1) {
    const heldLine = buffer.getLine(line);
    if (heldLine === undefined) continue;
    const continued = buffer.getLine(line + 1)?.isWrapped === true;
    const text = heldLine.translateToString(!continued, 0, columns);
    rows.push({ line, wrapped: heldLine.isWrapped, text: continued ? text : text.replace(/\s+$/, '') });
    carried = line;
  }
  rows.reverse();
  return {
    buffer: buffer.type,
    geometry: {
      rows: engine.rows,
      columns,
      firstLine: carried,
      viewportLine: buffer.baseY,
    },
    rows,
    cursor: { line: buffer.baseY + buffer.cursorY, column: buffer.cursorX },
  };
};

const styleOf = (cell: IBufferCell): CellStyle => ({
  foreground: cell.isFgDefault()
    ? { _tag: 'Default' }
    : cell.isFgPalette()
      ? { _tag: 'Palette', index: cell.getFgColor() }
      : { _tag: 'Rgb', value: cell.getFgColor() },
  background: cell.isBgDefault()
    ? { _tag: 'Default' }
    : cell.isBgPalette()
      ? { _tag: 'Palette', index: cell.getBgColor() }
      : { _tag: 'Rgb', value: cell.getBgColor() },
  underlineColor: cell.isUnderlineColorDefault()
    ? { _tag: 'Default' }
    : cell.isUnderlineColorPalette()
      ? { _tag: 'Palette', index: cell.getUnderlineColor() }
      : { _tag: 'Rgb', value: cell.getUnderlineColor() },
  underline: UNDERLINE[cell.getUnderlineStyle()] ?? 'none',
  bold: cell.isBold() !== 0,
  dim: cell.isDim() !== 0,
  italic: cell.isItalic() !== 0,
  blink: cell.isBlink() !== 0,
  inverse: cell.isInverse() !== 0,
  invisible: cell.isInvisible() !== 0,
  strikethrough: cell.isStrikethrough() !== 0,
  overline: cell.isOverline() !== 0,
});
