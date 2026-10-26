import type { InputProfile } from '@runlith/executions/protocol/inputProfile';
import type {
  CellStyle,
  ColorSlot,
  ScreenFrame,
  ScreenRow,
  ScreenTextFrame,
  ScreenTextRow,
} from '@runlith/executions/protocol/presentation';
import { screenRowText } from '@runlith/executions/protocol/presentationText';
import { UNVOICED } from '../../platform/contract/service/presentation.js';
import type { TerminalScreenReading } from '../contract/wire/operationAnswers.js';
import { type Answered, refWords, typedLines } from './execution.js';

type Frame = ScreenFrame | ScreenTextFrame;

const rowText = (row: ScreenRow | ScreenTextRow, continued: boolean): string =>
  'text' in row
    ? row.text
    : continued
      ? row.cells.map((cell) => (cell.chars === '' && cell.width > 0 ? ' ' : cell.chars)).join('')
      : screenRowText(row);

function* logicalLines(frame: Frame): Generator<string> {
  const rows: readonly (ScreenRow | ScreenTextRow)[] = frame.rows;
  let open: string | null = null;
  for (const [index, row] of rows.entries()) {
    const piece = rowText(row, rows[index + 1]?.wrapped === true);
    if (row.wrapped && open !== null) open += piece;
    else {
      if (open !== null) yield open.trimEnd();
      open = piece;
    }
  }
  if (open !== null) yield open.trimEnd();
}

function* screenBlock(frame: Frame): Generator<string> {
  let blank = 0;
  let any = false;
  for (const line of logicalLines(frame)) {
    if (line === '') {
      blank += 1;
      continue;
    }
    for (; blank > 0; blank -= 1) yield '';
    any = true;
    yield line;
  }
  if (!any) yield '(the screen is blank)';
}

const modeWords = (input: InputProfile): string => {
  if (input._tag === 'Unavailable') return `input profile unavailable: ${input.reason}`;
  const modes = [
    input.applicationCursor ? 'application cursor keys' : '',
    input.applicationKeypad ? 'application keypad' : '',
    input.bracketedPaste ? 'bracketed paste' : '',
    input.sendFocus ? 'focus events' : '',
    input.mouseTracking === 'none' ? '' : `mouse ${input.mouseTracking}`,
    input.mouseEncoding === 'default' ? '' : `mouse encoding ${input.mouseEncoding}`,
    input.kittyKeyboardFlags === 0 ? '' : `kitty keyboard flags ${input.kittyKeyboardFlags}`,
  ].filter((mode) => mode !== '');
  return modes.length === 0 ? 'no input mode changed from the default' : `modes: ${modes.join(', ')}`;
};

const colorWords = (slot: ColorSlot): string =>
  slot._tag === 'Palette' ? String(slot.index) : slot._tag === 'Rgb' ? `#${slot.value.toString(16).padStart(6, '0')}` : 'default';

const styleWords = (style: CellStyle): string =>
  [
    style.foreground._tag === 'Default' ? '' : `fg ${colorWords(style.foreground)}`,
    style.background._tag === 'Default' ? '' : `bg ${colorWords(style.background)}`,
    style.bold ? 'bold' : '',
    style.dim ? 'dim' : '',
    style.italic ? 'italic' : '',
    style.underline === 'none' ? '' : style.underline === 'single' ? 'underline' : `underline ${style.underline}`,
    style.underlineColor._tag === 'Default' ? '' : `underline ${colorWords(style.underlineColor)}`,
    style.blink ? 'blink' : '',
    style.inverse ? 'inverse' : '',
    style.invisible ? 'invisible' : '',
    style.strikethrough ? 'strikethrough' : '',
    style.overline ? 'overline' : '',
  ]
    .filter((word) => word !== '')
    .join(' ');

const runsOf = (row: ScreenRow): string => {
  const runs: string[] = [];
  let from = 0;
  let words = '';
  const close = (to: number) => {
    if (words !== '') runs.push(`${to - from > 1 ? `${from + 1}–${to}` : from + 1} ${words}`);
  };
  for (const [column, cell] of row.cells.entries()) {
    const own = styleWords(cell.style);
    if (own === words) continue;
    close(column);
    from = column;
    words = own;
  }
  close(row.cells.length);
  return runs.join('; ');
};

function* styleLines(frame: ScreenFrame): Generator<string> {
  yield '';
  let any = false;
  for (const [index, row] of frame.rows.entries()) {
    const runs = runsOf(row);
    if (runs === '') continue;
    if (!any) yield 'styles by row (rows from the first row of this answer, columns from 1):';
    any = true;
    yield `row ${index + 1}: ${runs}`;
  }
  if (!any) yield 'styles: none beyond the default';
}

function* screenLines(reading: typeof TerminalScreenReading.Type): Generator<string> {
  const { screen } = reading;
  if (screen._tag === 'ScreenUnavailable') {
    yield `${refWords(screen.ref)} no screen — ${screen.reason}${screen.ending === undefined ? '' : `, ${screen.ending}`}: ${screen.detail}`;
    yield `parsed through byte ${screen.parsedThrough}`;
    yield* typedLines(reading.typedBy);
    return;
  }
  const { geometry, cursor, provenance } = screen;
  const pointer =
    screen._tag === 'ScreenFrame'
      ? `, ${screen.appearance.cursor.style}${screen.appearance.cursor.blink ? ' blinking' : ''}${screen.appearance.cursor.visible ? '' : ' hidden'}`
      : '';
  yield `${refWords(provenance.ref)} screen ${geometry.columns}×${geometry.rows}, ${screen.buffer} buffer, cursor row ${
    cursor.line - geometry.viewportLine + 1
  } column ${cursor.column + 1}${pointer}, frame ${provenance.revision} parsed through byte ${provenance.parsedThrough}, input profile ${screen.input.revision}`;
  yield modeWords(screen.input);
  const title = screen._tag === 'ScreenFrame' ? screen.appearance.title : screen.title;
  if (title !== '') yield `title: ${title}`;
  const scrollback = screen.rows.filter((row) => row.line < geometry.viewportLine).length;
  if (scrollback > 0) yield `${scrollback} rows of scrollback come before the screen`;
  yield* typedLines(reading.typedBy);
  yield '';
  yield* screenBlock(screen);
  if (screen._tag === 'ScreenFrame') yield* styleLines(screen);
}

export const screenVoice = (answer: Answered<typeof TerminalScreenReading.Type>) =>
  answer.status === 'ok' ? screenLines(answer) : UNVOICED;
