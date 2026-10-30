import { expect, test } from 'bun:test';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { CellStyle, ScreenFrame, ScreenRow } from '@runlith/executions/protocol/presentation';
import { screenLines } from '@runlith/executions/protocol/presentationText';

test('screenLines offers the visible display and never the scrollback above it', () => {
  const frame = frameOf(['· 1 gone with the scrollback', 'still drawn   '], 1);
  expect(screenLines(frame)).toEqual(['still drawn']);
});

test('screenLines reads a cell the cursor moved over as a space and the tail of a wide character as nothing', () => {
  const frame = frameOf(['Yes I'], 0);
  const row = frame.rows[0]!;
  const cells = row.cells.map((cell) => (cell.chars === ' ' ? { ...cell, chars: '' } : cell));
  const wide = [
    { chars: '漢', width: 2, style: STYLE },
    { chars: '', width: 0, style: STYLE },
  ];
  expect(screenLines({ ...frame, rows: [{ ...row, cells: [...cells, ...wide] }] })).toEqual(['Yes I漢']);
});

const STYLE: CellStyle = {
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

const rowOf = (line: number, text: string): ScreenRow => ({
  line,
  wrapped: false,
  cells: [...text].map((chars) => ({ chars, width: 1, style: STYLE })),
});

const frameOf = (text: readonly string[], viewportLine: number): ScreenFrame => ({
  _tag: 'ScreenFrame',
  provenance: {
    ref: { installation: InstallationId.make('fixture'), execution: ExecutionId.make('fixture'), incarnation: 0 },
    revision: 1,
    parsedThrough: byteOffset(0n),
  },
  buffer: 'normal',
  geometry: { rows: text.length, columns: 80, firstLine: 0, viewportLine },
  rows: text.map((line, at) => rowOf(at, line)),
  cursor: { line: 0, column: 0 },
  appearance: {
    colors: { palette: Array.from({ length: 256 }, () => 0), foreground: 0, background: 0, cursor: 0 },
    cursor: { visible: true, style: 'block', blink: false },
    title: '',
  },
  input: { _tag: 'Unavailable', revision: 0, reason: 'a fixture publishes no input profile' },
});
