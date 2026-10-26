import type { ScreenAppearance, TerminalColors } from './appearance';
import type {
  BufferKind,
  CellStyle,
  ColorSlot,
  CursorPosition,
  PaintProgram,
  PaintStep,
  ScreenCell,
  ScreenGeometry,
  ScreenRow,
  ScreenUnavailable,
  ScreenFeedItem,
} from './presentation';
import type { ExecutionRef } from './execution';
import type { ByteOffset } from './record';

export type PaintRefusal = {
  readonly _tag: 'PaintRefused';
  readonly reason: 'unavailable' | 'row-outside-viewport' | 'geometry' | 'unprintable';
  readonly detail: string;
};

export type PaintAnswer = PaintProgram | PaintRefusal;

const ESC = '\u001b';
const CSI = `${ESC}[`;

const ALTERNATE = `${CSI}?1049h`;
const NORMAL = `${CSI}?1049l`;

const refuse = (reason: PaintRefusal['reason'], detail: string): PaintRefusal => ({ _tag: 'PaintRefused', reason, detail });

export const refusalAsUnavailable = (args: {
  readonly ref: ExecutionRef;
  readonly parsedThrough: ByteOffset;
  readonly refusal: PaintRefusal;
}): ScreenUnavailable => ({
  _tag: 'ScreenUnavailable',
  ref: args.ref,
  parsedThrough: args.parsedThrough,
  reason: 'engine',
  detail: args.refusal.detail,
});

const unprintable = (chars: string): boolean => {
  for (const character of chars) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
  }
  return false;
};

const colorParameters = (slot: ColorSlot, kind: 'foreground' | 'background' | 'underline'): string => {
  const [set, reset] = kind === 'foreground' ? ['38', '39'] : kind === 'background' ? ['48', '49'] : ['58', '59'];
  if (slot._tag === 'Default') return reset;
  if (slot._tag === 'Palette') return `${set};5;${slot.index}`;
  return `${set};2;${(slot.value >> 16) & 0xff};${(slot.value >> 8) & 0xff};${slot.value & 0xff}`;
};

const UNDERLINE_PARAMETER: Record<CellStyle['underline'], string> = {
  none: '4:0',
  single: '4:1',
  double: '4:2',
  curly: '4:3',
  dotted: '4:4',
  dashed: '4:5',
};

const attributes = (style: CellStyle): string => {
  const parameters = ['0'];
  if (style.bold) parameters.push('1');
  if (style.dim) parameters.push('2');
  if (style.italic) parameters.push('3');
  if (style.blink) parameters.push('5');
  if (style.inverse) parameters.push('7');
  if (style.invisible) parameters.push('8');
  if (style.strikethrough) parameters.push('9');
  if (style.overline) parameters.push('53');
  if (style.underline !== 'none') parameters.push(UNDERLINE_PARAMETER[style.underline]);
  parameters.push(colorParameters(style.foreground, 'foreground'));
  parameters.push(colorParameters(style.background, 'background'));
  if (style.underlineColor._tag !== 'Default') parameters.push(colorParameters(style.underlineColor, 'underline'));
  return `${CSI}${parameters.join(';')}m`;
};

const sameStyle = (a: CellStyle, b: CellStyle): boolean =>
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

const sameSlot = (a: ColorSlot, b: ColorSlot): boolean =>
  a._tag === b._tag &&
  (a._tag === 'Palette' ? a.index === (b as typeof a).index : a._tag === 'Rgb' ? a.value === (b as typeof a).value : true);

const sameRow = (a: ScreenRow, b: ScreenRow): boolean => {
  if (a === b) return true;
  if (a.wrapped !== b.wrapped || a.cells.length !== b.cells.length) return false;
  if (a.cells === b.cells) return true;
  for (let index = 0; index < a.cells.length; index += 1) {
    const left = a.cells[index]!;
    const right = b.cells[index]!;
    if (left === right) continue;
    if (left.chars !== right.chars || left.width !== right.width || !sameStyle(left.style, right.style)) return false;
  }
  return true;
};

const erasable = (cell: ScreenCell): boolean =>
  cell.width === 1 &&
  (cell.chars === '' || cell.chars === ' ') &&
  cell.style.background._tag === 'Default' &&
  cell.style.underline === 'none' &&
  !cell.style.inverse &&
  !cell.style.strikethrough &&
  !cell.style.overline;

const paintedWidth = (cells: ReadonlyArray<ScreenCell>): number => {
  let last = cells.length;
  while (last > 0 && erasable(cells[last - 1] as ScreenCell)) last -= 1;
  return last;
};

const paintRow = (row: ScreenRow): string | PaintRefusal => {
  const painted = paintedWidth(row.cells);
  let data = '';
  let held: CellStyle | undefined;
  for (let index = 0; index < painted; index += 1) {
    const cell = row.cells[index] as ScreenCell;
    if (cell.width === 0) continue;
    if (unprintable(cell.chars)) {
      return refuse('unprintable', `line ${row.line} column ${index} carries a control character`);
    }
    if (held === undefined || !sameStyle(held, cell.style)) {
      data += attributes(cell.style);
      held = cell.style;
    }
    data += cell.chars === '' ? ' ' : cell.chars;
  }
  return `${data}${CSI}0m${CSI}K`;
};

const viewportRow = (line: number, viewportLine: number, rows: number): number | undefined => {
  const row = line - viewportLine + 1;
  return row >= 1 && row <= rows ? row : undefined;
};

export const scrollText = (top: number, bottom: number, lines: number): string =>
  lines > 0 ? `${CSI}${bottom};1H${'\r\n'.repeat(lines)}` : `${CSI}${top};${bottom}r${CSI}${Math.abs(lines)}T${CSI}r`;

export const detectScroll = (
  baseRows: ReadonlyArray<ScreenRow>,
  nextRows: ReadonlyArray<ScreenRow>,
  rows: number,
): { readonly lines: number } | undefined => {
  const n = Math.min(baseRows.length, nextRows.length, rows);
  if (n < 2) return undefined;
  const base = baseRows.slice(-n);
  const next = nextRows.slice(-n);
  let identical = true;
  for (let index = 0; index < n; index += 1) {
    if (!sameRow(base[index] as ScreenRow, next[index] as ScreenRow)) {
      identical = false;
      break;
    }
  }
  if (identical) return undefined;
  const upMatch = (k: number): number => {
    let matched = 0;
    while (matched + k < n && sameRow(next[matched] as ScreenRow, base[matched + k] as ScreenRow)) matched += 1;
    return matched;
  };
  const downMatch = (k: number): number => {
    let matched = 0;
    while (k + matched < n && sameRow(next[k + matched] as ScreenRow, base[matched] as ScreenRow)) matched += 1;
    return matched;
  };
  const isShift = (matched: number, k: number): boolean => matched > 0 && (matched === n - k || matched === n - k - 1);
  for (let k = 1; k < n; k += 1) {
    if (isShift(upMatch(k), k)) return { lines: k };
  }
  for (let k = 1; k < n; k += 1) {
    if (isShift(downMatch(k), k)) return { lines: -k };
  }
  return undefined;
};

const samePalette = (a: TerminalColors, b: TerminalColors): boolean =>
  a.foreground === b.foreground &&
  a.background === b.background &&
  a.cursor === b.cursor &&
  a.palette.length === b.palette.length &&
  a.palette.every((entry, index) => entry === b.palette[index]);

const sameAppearance = (a: ScreenAppearance, b: ScreenAppearance): boolean =>
  samePalette(a.colors, b.colors) &&
  a.cursor.visible === b.cursor.visible &&
  a.cursor.style === b.cursor.style &&
  a.cursor.blink === b.cursor.blink &&
  a.title === b.title;

const checkGeometry = (geometry: ScreenGeometry, cursor: CursorPosition): { readonly place: string } | PaintRefusal => {
  if (geometry.viewportLine < geometry.firstLine) {
    return refuse('geometry', `the viewport at ${geometry.viewportLine} stands above the first line ${geometry.firstLine}`);
  }
  const cursorRow = viewportRow(cursor.line, geometry.viewportLine, geometry.rows);
  if (cursorRow === undefined) {
    return refuse('geometry', `the cursor at line ${cursor.line} stands outside the ${geometry.rows} visible rows`);
  }
  return { place: `${CSI}${cursorRow};${cursor.column + 1}H` };
};

type ScreenContent = {
  readonly buffer: BufferKind;
  readonly geometry: ScreenGeometry;
  readonly rows: ReadonlyArray<ScreenRow>;
  readonly cursor: CursorPosition;
  readonly appearance: ScreenAppearance;
};

export const presentationEncodeFullFrame = (screen: ScreenContent): PaintAnswer => {
  const checked = checkGeometry(screen.geometry, screen.cursor);
  if (!('place' in checked)) return checked;
  const steps: PaintStep[] = [
    { _tag: 'Theme', colors: screen.appearance.colors },
    { _tag: 'Resize', rows: screen.geometry.rows, columns: screen.geometry.columns },
  ];
  const painted: string[] = [];
  for (const row of screen.rows) {
    const line = paintRow(row);
    if (typeof line !== 'string') return line;
    painted.push(line);
  }
  steps.push({ _tag: 'Reset' });
  steps.push({
    _tag: 'Write',
    data: `${screen.buffer === 'alternate' ? ALTERNATE : NORMAL}${CSI}1;1H${painted.join('\r\n')}${checked.place}`,
  });
  steps.push({ _tag: 'Cursor', cursor: screen.appearance.cursor });
  steps.push({ _tag: 'Title', title: screen.appearance.title });
  return { _tag: 'PaintProgram', steps };
};

export const presentationEncodeRowPatch = (screen: ScreenContent): PaintAnswer => {
  const checked = checkGeometry(screen.geometry, screen.cursor);
  if (!('place' in checked)) return checked;
  const steps: PaintStep[] = [
    { _tag: 'Theme', colors: screen.appearance.colors },
    { _tag: 'Resize', rows: screen.geometry.rows, columns: screen.geometry.columns },
  ];
  let data = '';
  for (const row of screen.rows) {
    const at = viewportRow(row.line, screen.geometry.viewportLine, screen.geometry.rows);
    if (at === undefined) {
      return refuse('row-outside-viewport', `line ${row.line} stands outside the ${screen.geometry.rows} visible rows`);
    }
    const line = paintRow(row);
    if (typeof line !== 'string') return line;
    data += `${CSI}${at};1H${line}`;
  }
  steps.push({ _tag: 'Write', data: `${data}${checked.place}` });
  steps.push({ _tag: 'Cursor', cursor: screen.appearance.cursor });
  steps.push({ _tag: 'Title', title: screen.appearance.title });
  return { _tag: 'PaintProgram', steps };
};

export type PatchBase = {
  readonly rows: ReadonlyArray<ScreenRow>;
  readonly viewportLine: number;
  readonly appearance: ScreenAppearance;
};

export const presentationEncodePatch = (base: PatchBase, screen: ScreenContent): PaintAnswer => {
  const checked = checkGeometry(screen.geometry, screen.cursor);
  if (!('place' in checked)) return checked;
  const steps: PaintStep[] = [];
  if (!samePalette(base.appearance.colors, screen.appearance.colors)) {
    steps.push({ _tag: 'Theme', colors: screen.appearance.colors });
  }
  const scrolled = detectScroll(base.rows, screen.rows, screen.geometry.rows);
  if (scrolled !== undefined) {
    const n = Math.min(base.rows.length, screen.rows.length, screen.geometry.rows);
    const before = base.rows.slice(-n);
    const after = screen.rows.slice(-n);
    const k = scrolled.lines;
    let data = '';
    for (let index = 0; index < after.length; index += 1) {
      const row = after[index] as ScreenRow;
      const from = k > 0 ? index + k : index + k;
      const held = from >= 0 && from < n ? before[from] : undefined;
      if (held !== undefined && sameRow(held, row)) continue;
      const at = viewportRow(row.line, screen.geometry.viewportLine, screen.geometry.rows);
      if (at === undefined) return presentationEncodeRowPatch(screen);
      const line = paintRow(row);
      if (typeof line !== 'string') return line;
      data += `${CSI}${at};1H${line}`;
    }
    steps.push({ _tag: 'Scroll', top: 1, bottom: screen.geometry.rows, lines: scrolled.lines });
    steps.push({ _tag: 'Write', data: `${data}${checked.place}` });
  } else {
    const before = new Map<number, ScreenRow>();
    for (const row of base.rows) if (row.line >= screen.geometry.viewportLine) before.set(row.line, row);
    let data = '';
    for (const row of screen.rows) {
      if (row.line < screen.geometry.viewportLine) continue;
      const held = before.get(row.line);
      if (held !== undefined && sameRow(held, row)) continue;
      const at = viewportRow(row.line, screen.geometry.viewportLine, screen.geometry.rows);
      if (at === undefined) {
        return refuse('row-outside-viewport', `line ${row.line} stands outside the ${screen.geometry.rows} visible rows`);
      }
      const line = paintRow(row);
      if (typeof line !== 'string') return line;
      data += `${CSI}${at};1H${line}`;
    }
    steps.push({ _tag: 'Write', data: `${data}${checked.place}` });
  }
  if (
    base.appearance.cursor.visible !== screen.appearance.cursor.visible ||
    base.appearance.cursor.style !== screen.appearance.cursor.style ||
    base.appearance.cursor.blink !== screen.appearance.cursor.blink
  ) {
    steps.push({ _tag: 'Cursor', cursor: screen.appearance.cursor });
  }
  if (base.appearance.title !== screen.appearance.title) {
    steps.push({ _tag: 'Title', title: screen.appearance.title });
  }
  return { _tag: 'PaintProgram', steps };
};

export const presentationPaint = (update: ScreenFeedItem): PaintAnswer => {
  if (update._tag === 'ScreenUnavailable') return refuse('unavailable', update.detail);
  if (update._tag === 'ScreenProgramFrame' || update._tag === 'ScreenProgramPatch') return update.program;
  const { geometry, rows: screenRows, cursor, appearance, buffer } = update;
  const screen = { buffer, geometry, rows: screenRows, cursor, appearance };
  return update._tag === 'ScreenFrame' ? presentationEncodeFullFrame(screen) : presentationEncodeRowPatch(screen);
};
