import { expect, test } from 'bun:test';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { CellStyle, ScreenFrame, ScreenRow } from '@runlith/executions/protocol/presentation';
import type { HarnessWidgetKey } from '@runlith/tagma/adapter/harness';
import { claudeTerminal as claudeCode } from '@runlith/adapter-anthropic/harness';
import { codex } from '../vendors/codex/row.js';
import { cursor } from '../vendors/cursor/row.js';
import { devin } from '../vendors/devin/row.js';
import { screenLines } from '@runlith/executions/protocol/presentationText';

const WIDGET = [
  '',
  '⠀⣴⣾⣶⡄⠀⠀⠀⠀',
  '⠀⠛⠿⠟⠻⣶⣾⣶⡄  Devin CLI',
  '⠀⣤⣶⣦⣴⠿⢿⠿⠃  v3000.10.27',
  '⠀⠻⢿⠿⠃⠀⠀⠀⠀',
  '',
  '❭ Какая сейчас погода в Белграде? Ответь одной короткой строкой.',
  '',
  'Pro · 99% remaining (resets in 3d 7h)',
  '',
  ' ⏺ Invoked skill web-search',
  '',
  ' ⏺ Fetching https://wttr.in/Belgrade?format=%t+%C',
  '',
  '❭ 1 Yes  (Approve once)',
  '· 2 Yes, allow fetches to wttr.in/*',
  '· 3 Yes, always allow fetches to wttr.in/*',
  '· 4 Yes, always allow all web fetches',
  '· 5 Yes, switch to bypass mode',
  '· 6 No',
  '↑↓ select · ↵ confirm · esc cancel',
  '',
] as const;

test('a live Devin approval widget is read as a choice carrying every option in the CLI’s own words', () => {
  const ask = devin.screenAskOf(WIDGET);
  expect(ask).toEqual({
    kind: 'choice',
    prompt: 'Fetching https://wttr.in/Belgrade?format=%t+%C',
    header: null,
    subject: 'https://wttr.in/Belgrade?format=%t+%C',
    options: [
      { value: '1', label: 'Yes  (Approve once)' },
      { value: '2', label: 'Yes, allow fetches to wttr.in/*' },
      { value: '3', label: 'Yes, always allow fetches to wttr.in/*' },
      { value: '4', label: 'Yes, always allow all web fetches' },
      { value: '5', label: 'Yes, switch to bypass mode' },
      { value: '6', label: 'No' },
    ],
    selected: '1',
  });
});

test('a Devin question too wide for the terminal is published whole, not as its last wrapped row', () => {
  const wrapped = [
    ' ⏺ Running command: npm run build --workspace=apps/tagma/server --silent -- --reporter=do',
    'ts --max-warnings=0',
    '',
    '❭ 1 Yes  (Approve once)',
    '· 2 No',
    '↑↓ select · ↵ confirm · esc cancel',
  ];
  expect(devin.screenAskOf(wrapped)?.prompt).toBe(
    'Running command: npm run build --workspace=apps/tagma/server --silent -- --reporter=dots --max-warnings=0',
  );
});

test('a widget names the invocation it asks about only where the CLI draws it in a measured form', () => {
  const run = ['⏺ Running command: git push origin main', '', '❭ 1 Yes', '· 2 No', '↑↓ select · ↵ confirm · esc cancel'];
  expect(devin.screenAskOf(run)?.subject).toBe('git push origin main');
  expect(devin.screenAskOf(['Waiting for your answer', ...run.slice(1)])?.subject).toBeNull();
  const codexRun = ['$ git push origin main', '› 1. Yes (y)', '  2. No (n)', 'Press enter to confirm or esc to cancel'];
  expect(codex.screenAskOf(codexRun)?.subject).toBe('git push origin main');
});

test('a block with no transcript dot above it publishes the nearest line alone', () => {
  const plain = [
    'Pro · 99% remaining (resets in 3d 7h)',
    'Waiting for your answer',
    '❭ 1 Yes  (Approve once)',
    '· 2 No',
    '↑↓ select · ↵ confirm · esc cancel',
  ];
  expect(devin.screenAskOf(plain)?.prompt).toBe('Waiting for your answer');
});

test('Devin walks its cursor from where it stands to the option answered, then takes it', () => {
  const ask = devin.screenAskOf(WIDGET)!;
  expect(devin.keysOf(ask, ['5'])).toEqual(['down', 'down', 'down', 'down', 'enter']);
  expect(devin.keysOf(ask, ['1'])).toEqual(['enter']);
  const lower = { ...ask, selected: '4' };
  expect(devin.keysOf(lower, ['2'])).toEqual(['up', 'up', 'enter']);
  expect(devin.cancelKeysOf(ask)).toEqual(['esc']);
});

test('Devin names no strokes for a value its widget is not offering, or with no cursor to walk from', () => {
  const ask = devin.screenAskOf(WIDGET)!;
  expect(devin.keysOf(ask, ['7'])).toBeNull();
  expect(devin.keysOf({ ...ask, selected: null }, ['2'])).toBeNull();
});

test('a widget drawn with no cursor row names no selection', () => {
  const undrawn = WIDGET.map((line) => (line.startsWith('❭ 1') ? line.replace('❭', '·') : line));
  expect(devin.screenAskOf(undrawn)?.selected).toBeNull();
  expect(devin.screenAskOf(undrawn)?.options).toHaveLength(6);
});

test('a widget whose first options are not drawn yet raises nothing', () => {
  const half = [...WIDGET.slice(0, 14), ...WIDGET.slice(17)];
  expect(half).toContain('· 4 Yes, always allow all web fetches');
  expect(devin.screenAskOf(half)).toBeNull();
});

test('a transcript with no footer declaring the widget’s keys raises nothing', () => {
  expect(devin.screenAskOf(WIDGET.filter((line) => !line.startsWith('↑↓')))).toBeNull();
});

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

const CODEX_WIDGET = [
  'Allow this command?',
  '› 1. Yes, just this once (y)',
  "  2. Yes, and don't ask again (a)",
  '  3. No (n)',
  'Press enter to confirm or esc to cancel',
] as const;

test('Codex’s overlay is read as a choice carrying every option in the CLI’s own words', () => {
  expect(codex.screenAskOf(CODEX_WIDGET)).toEqual({
    kind: 'choice',
    prompt: 'Allow this command?',
    header: null,
    subject: null,
    options: [
      { value: '1', label: 'Yes, just this once (y)' },
      { value: '2', label: "Yes, and don't ask again (a)" },
      { value: '3', label: 'No (n)' },
    ],
    selected: '1',
  });
});

test('Codex without its footer, or with a half-drawn list, raises nothing', () => {
  expect(codex.screenAskOf(CODEX_WIDGET.filter((line) => !line.startsWith('Press')))).toBeNull();
  expect(codex.screenAskOf(['Allow this command?', '  2. Yes', '  3. No', 'Press enter to confirm or esc to cancel'])).toBeNull();
});

const CURSOR_WIDGET = [
  'Run this command?',
  '→ Run (once) (y)',
  '  Add … to allowlist? (tab)',
  '  Skip & tell the agent what to do instead (esc or n)',
] as const;

test('Cursor’s unnumbered decision is read as a choice whose values are the labels it drew', () => {
  expect(cursor.screenAskOf(CURSOR_WIDGET)).toEqual({
    kind: 'choice',
    prompt: 'Run this command?',
    header: null,
    subject: null,
    options: [
      { value: 'Run (once) (y)', label: 'Run (once) (y)' },
      { value: 'Add … to allowlist? (tab)', label: 'Add … to allowlist? (tab)' },
      { value: 'Skip & tell the agent what to do instead (esc or n)', label: 'Skip & tell the agent what to do instead (esc or n)' },
    ],
    selected: 'Run (once) (y)',
  });
});

test('Cursor transcript arrows without a parenthetical shortcut raise nothing', () => {
  expect(cursor.screenAskOf(['→ ordinary transcript', '  more text'])).toBeNull();
});

test('a Cursor decision still loading its Run Everything row raises nothing', () => {
  const loading = [
    'Run this command?',
    '→ Run (once) (y)',
    '  Add … to allowlist? (tab)',
    '  Checking Run Everything availability (loading)',
    '  Skip & tell the agent what to do instead (esc or n)',
  ];
  expect(cursor.screenAskOf(loading)).toBeNull();
  const resolved = loading.map((line) => line.replace('Checking Run Everything availability (loading)', 'Run Everything (shift+tab)'));
  expect(cursor.screenAskOf(resolved)?.options).toHaveLength(4);
});

test('a widget still painting its tail raises nothing on the rows with no footer', () => {
  expect(claudeCode.screenAskOf(CLAUDE_WIDGET.slice(0, -1))).toBeNull();
  expect(cursor.screenAskOf(CURSOR_WIDGET.slice(0, -1))).toBeNull();
  expect(claudeCode.screenAskOf(CLAUDE_WIDGET)?.options).toHaveLength(3);
  expect(cursor.screenAskOf(CURSOR_WIDGET)?.options).toHaveLength(3);
});

const chars = (text: string): readonly HarnessWidgetKey[] => [...text].map((char) => ({ _tag: 'char', char }));

test('the numbered rows answer by typing the value’s own digits, cursor or none', () => {
  const rows = [
    { row: claudeCode, ask: claudeCode.screenAskOf(CLAUDE_WIDGET)!, value: '3' },
    { row: codex, ask: codex.screenAskOf(CODEX_WIDGET)!, value: '2' },
  ] as const;
  for (const { row, ask, value } of rows) {
    expect(row.keysOf(ask, [value])).toEqual(chars(value));
    expect(row.keysOf({ ...ask, selected: null }, [value])).toEqual(chars(value));
    expect(row.keysOf(ask, ['9'])).toBeNull();
    expect(row.cancelKeysOf(ask)).toEqual(['esc']);
  }
});

test('Cursor walks its cursor to the option answered, and refuses without one', () => {
  const ask = cursor.screenAskOf(CURSOR_WIDGET)!;
  const last = 'Skip & tell the agent what to do instead (esc or n)';
  expect(cursor.keysOf(ask, [last])).toEqual(['down', 'down', 'enter']);
  expect(cursor.keysOf(ask, ['Run (once) (y)'])).toEqual(['enter']);
  expect(cursor.keysOf({ ...ask, selected: last }, ['Add … to allowlist? (tab)'])).toEqual(['up', 'enter']);
  expect(cursor.keysOf({ ...ask, selected: null }, [last])).toBeNull();
  expect(cursor.keysOf(ask, ['Run Everything'])).toBeNull();
  expect(cursor.cancelKeysOf(ask)).toEqual(['esc']);
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
