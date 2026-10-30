import { expect, test } from 'bun:test';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { CellStyle, ScreenFrame, ScreenRow } from '@runlith/executions/protocol/presentation';
import type { HarnessWidgetKey } from '@runlith/tagma/adapter/harness';
import { claudeTerminal as claudeCode } from '@runlith/adapter-anthropic/harness';
import { screenLines } from '@runlith/executions/protocol/presentationText';

const CLAUDE_WIDGET = [
  'Claude wants to run git push origin main',
  '❯ 1. Yes',
  "  2. Yes, and don't ask again for git push",
  '  3. No, and tell Claude what to do differently (esc)',
] as const;

test('Claude’s numbered select is read as a choice carrying every option in the CLI’s own words', () => {
  expect(claudeCode.screenAskOf(CLAUDE_WIDGET)).toEqual({
    kind: 'choice',
    prompt: 'Claude wants to run git push origin main',
    header: null,
    subject: 'git push origin main',
    options: [
      { value: '1', label: 'Yes' },
      { value: '2', label: "Yes, and don't ask again for git push" },
      { value: '3', label: 'No, and tell Claude what to do differently (esc)' },
    ],
    selected: '1',
  });
});

test('a widget still painting its tail raises nothing on the rows with no footer', () => {
  expect(claudeCode.screenAskOf(CLAUDE_WIDGET.slice(0, -1))).toBeNull();
  expect(claudeCode.screenAskOf(CLAUDE_WIDGET)?.options).toHaveLength(3);
});

const chars = (text: string): readonly HarnessWidgetKey[] => [...text].map((char) => ({ _tag: 'char', char }));

test('the numbered rows answer by typing the value’s own digits, cursor or none', () => {
  const rows = [{ row: claudeCode, ask: claudeCode.screenAskOf(CLAUDE_WIDGET)!, value: '3' }] as const;
  for (const { row, ask, value } of rows) {
    expect(row.keysOf(ask, [value])).toEqual(chars(value));
    expect(row.keysOf({ ...ask, selected: null }, [value])).toEqual(chars(value));
    expect(row.keysOf(ask, ['9'])).toBeNull();
    expect(row.cancelKeysOf(ask)).toEqual(['esc']);
  }
});

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
