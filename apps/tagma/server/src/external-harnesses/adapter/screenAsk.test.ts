import { expect, test } from 'bun:test';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { CellStyle, ScreenFrame, ScreenRow } from '@runlith/executions/protocol/presentation';
import type { HarnessWidgetKey } from '@runlith/tagma/adapter/harness';
import { claudeCode } from '../vendors/claude-code/row.js';
import { codex } from '../vendors/codex/row.js';
import { cursor } from '../vendors/cursor/row.js';
import { devin } from '../vendors/devin/row.js';
import { gemini } from '../vendors/gemini/row.js';
import { grok } from '../vendors/grok/row.js';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import { sameScreenAsk, unmeasuredScreen } from './screenAsk.js';

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

test('a row whose own screens nobody measured raises nothing from the widget of another vendor', () => {
  expect(unmeasuredScreen(WIDGET)).toBeNull();
  expect(grok.screenAskOf(WIDGET)).toBeNull();
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

const CLAUDE_PERMISSION = [
  '────────────────────────────────────────',
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  ' Create the file',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' touch made.txt',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /work from this',
  '      project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  '',
  ' Esc to cancel · Tab to amend',
] as const;

test('Claude’s permission screen in a permission mode of its own is read whole, a wrapped option joined, and answered by its number', () => {
  const ask = claudeCode.screenAskOf(CLAUDE_PERMISSION)!;
  expect(ask.prompt).toBe(
    'Bash command\nTip: auto mode handles these prompts for you — choose "switch to auto mode" below\nCreate the file\ntouch made.txt\nDo you want to proceed?',
  );
  expect(ask.options).toEqual([
    { value: '1', label: 'Yes' },
    { value: '2', label: 'Yes, and always allow access to /work from this project' },
    { value: '3', label: 'Yes, and switch to auto mode · auto mode handles these prompts for you' },
    { value: '4', label: 'No' },
  ]);
  expect(ask.selected).toBe('1');
  expect(ask.subject).toBe('touch made.txt');
  expect(claudeCode.keysOf(ask, ['4'])).toEqual([{ _tag: 'char', char: '4' }]);
  const moved = CLAUDE_PERMISSION.map((line) =>
    line === ' ❯ 1. Yes' ? '   1. Yes' : line.startsWith('   3. ') ? line.replace('   3. ', ' ❯ 3. ') : line,
  );
  const pointedLower = claudeCode.screenAskOf(moved)!;
  expect(pointedLower.selected).toBe('3');
  expect(sameScreenAsk(pointedLower, ask)).toBe(true);
  expect(claudeCode.screenAskOf(CLAUDE_PERMISSION.slice(0, -1))).toBeNull();
});

const CLAUDE_TRUST = [
  '',
  '────────────────────────────────────────',
  ' Accessing workspace:',
  '',
  ' /opt/workspaces/polygon',
  '',
  ' Quick safety check: Is this a project you created or one you trust?',
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
  '',
] as const;

test('Claude’s unnumbered confirmation is read as a choice whose values are its labels, answered by walking its pointer', () => {
  const ask = claudeCode.screenAskOf(CLAUDE_TRUST)!;
  expect(ask).toEqual({
    kind: 'choice',
    prompt:
      'Accessing workspace:\n/opt/workspaces/polygon\nQuick safety check: Is this a project you created or one you trust?\nSecurity guide',
    header: null,
    subject: null,
    options: [
      { value: 'No, exit', label: 'No, exit' },
      { value: 'Yes, I trust this folder', label: 'Yes, I trust this folder' },
    ],
    selected: 'No, exit',
  });
  expect(claudeCode.keysOf(ask, ['Yes, I trust this folder'])).toEqual(['down', 'enter']);
  expect(claudeCode.keysOf({ ...ask, selected: 'Yes, I trust this folder' }, ['No, exit'])).toEqual(['up', 'enter']);
  expect(claudeCode.keysOf(ask, ['2'])).toBeNull();
  expect(claudeCode.cancelKeysOf(ask)).toEqual(['esc']);
});

test('Claude’s confirmation without its footer, or with no pointer among its rows, raises nothing', () => {
  expect(claudeCode.screenAskOf(CLAUDE_TRUST.slice(0, -2))).toBeNull();
  expect(claudeCode.screenAskOf(CLAUDE_TRUST.map((line) => line.replace('❯', ' ')))).toBeNull();
});

const CLAUDE_QUESTION = [
  '⏺ I need clarification on the specific gap before making changes. · summary',
  '─────────────────────────────────────────────────────────────',
  ' ☐ Missing pair',
  '',
  '│ Currently only USD→XYZ pairs are requested from the provider (prepareCurrencyPairs), and every cross rate goes through them. What',
  "│ does 'the provider has no pair' mean in your case?",
  '',
  '❯ 1. No USDXYZ, only XYZUSD',
  '     Provider lacks USD→XYZ but has XYZ→USD. Fall back to requesting/inverting XYZUSD when USDXYZ returns nothing.',
  '  2. No USD pair at all',
  '     Provider has no pair with USD for XYZ, but has one against another currency (e.g. EURXYZ). Derive XYZ→USD through that other',
  "     currency's USD pair.",
  '  3. Cross pairs fail',
  "     USD pairs exist, but some code path doesn't fall back to USD.",
  '  4. Type something.',
  '─────────────────────────────────────────────────────────────',
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
] as const;

test('Claude’s own question is read with its header, the descriptions of its options and the row that takes typed words', () => {
  const ask = claudeCode.screenAskOf(CLAUDE_QUESTION)!;
  expect(ask).toMatchObject({
    header: 'Missing pair',
    prompt:
      "Currently only USD→XYZ pairs are requested from the provider (prepareCurrencyPairs), and every cross rate goes through them. What does 'the provider has no pair' mean in your case?",
    selected: '1',
    freeform: { value: '4', draft: '' },
  });
  expect(ask.picks).toBeUndefined();
  expect(ask.options.map((option) => [option.value, option.label])).toEqual([
    ['1', 'No USDXYZ, only XYZUSD'],
    ['2', 'No USD pair at all'],
    ['3', 'Cross pairs fail'],
    ['5', 'Chat about this'],
  ]);
  expect(ask.options[1]!.description).toBe(
    "Provider has no pair with USD for XYZ, but has one against another currency (e.g. EURXYZ). Derive XYZ→USD through that other currency's USD pair.",
  );
  const drafted = claudeCode.screenAskOf(
    CLAUDE_QUESTION.map((line) => (line === '  4. Type something.' ? '  4. teal, with a border' : line)),
  )!;
  expect(sameScreenAsk(drafted, ask)).toBe(true);
  expect(drafted.freeform).toEqual({ value: '4', draft: 'teal, with a border' });
  expect(claudeCode.screenAskOf(CLAUDE_QUESTION.slice(0, -1))).toBeNull();
});

const KILL = { _tag: 'char', char: '\u000b' } as const;

test('Claude’s own question takes an option by its number and typed words through its typed row, replacing a draft left there', () => {
  const ask = claudeCode.screenAskOf(CLAUDE_QUESTION)!;
  expect(claudeCode.keysOf(ask, ['2'])).toEqual(chars('2'));
  expect(claudeCode.keysOf(ask, ['5'])).toEqual(chars('5'));
  expect(claudeCode.keysOf(ask, ['Invert XYZUSD,\nthen retry'])).toEqual([
    ...chars('4'),
    { _tag: 'text', text: 'Invert XYZUSD, then retry' },
    'enter',
  ]);
  const standing = { ...ask, selected: '4' };
  expect(claudeCode.keysOf(standing, ['2'])).toEqual(['up', ...chars('2')]);
  expect(claudeCode.keysOf(standing, ['Invert'])).toEqual([{ _tag: 'text', text: 'Invert' }, 'enter']);
  const drafted = { ...ask, freeform: { value: '4', draft: 'teal' } };
  expect(claudeCode.keysOf(drafted, ['blue'])).toEqual(['down', 'down', 'down', KILL, { _tag: 'text', text: 'blue' }, 'enter']);
  expect(claudeCode.keysOf({ ...drafted, selected: '4' }, ['blue'])).toEqual(['up', 'down', KILL, { _tag: 'text', text: 'blue' }, 'enter']);
  expect(claudeCode.keysOf(ask, ['1', '2'])).toBeNull();
  expect(claudeCode.keysOf(ask, ['   '])).toBeNull();
});

const CLAUDE_PICKS = [
  '←  ☒ Toppings  ✔ Submit  →',
  '',
  'Which toppings?',
  '',
  '❯ 1. [✔] Cheese',
  '         A classic layer of melted cheese.',
  '  2. [ ] Ham',
  '         Thin slices of cooked ham.',
  '  3. [ ] Olives',
  '         Sliced black or green olives.',
  '  4. [ ] Type something',
  '     Submit',
  '─────────────────────────────────────────────────────────────',
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
] as const;

test('Claude’s question of several picks is read with what stands checked, its labels free of their boxes', () => {
  const ask = claudeCode.screenAskOf(CLAUDE_PICKS)!;
  expect(ask).toMatchObject({
    header: null,
    prompt: 'Which toppings?',
    selected: '1',
    freeform: { value: '4', draft: '' },
    picks: { checked: ['1'] },
  });
  expect(ask.options.map((option) => option.label)).toEqual(['Cheese', 'Ham', 'Olives', 'Chat about this']);
  const onSubmit = CLAUDE_PICKS.map((line) =>
    line === '❯ 1. [✔] Cheese' ? '  1. [✔] Cheese' : line === '     Submit' ? '❯    Submit' : line,
  );
  expect(claudeCode.screenAskOf(onSubmit)!.selected).toBeNull();
  expect(claudeCode.screenAskOf(CLAUDE_PICKS.filter((line) => line !== '     Submit'))).toBeNull();
});

test('Claude’s question of several picks toggles only what differs, types words in its typed row and submits from its Submit row', () => {
  const ask = claudeCode.screenAskOf(CLAUDE_PICKS)!;
  expect(claudeCode.keysOf(ask, ['2'])).toEqual([...chars('1'), ...chars('2'), 'down', 'down', 'down', 'down', 'enter']);
  expect(claudeCode.keysOf(ask, ['1', 'anchovies'])).toEqual([
    ...chars('4'),
    'down',
    'down',
    'down',
    { _tag: 'text', text: 'anchovies' },
    'down',
    'enter',
  ]);
  expect(claudeCode.keysOf({ ...ask, selected: null }, ['1'])).toEqual(['enter']);
  expect(claudeCode.keysOf({ ...ask, selected: null }, ['1', '3'])).toEqual(['up', 'up', ...chars('3'), 'down', 'down', 'enter']);
  const drafted = { ...ask, freeform: { value: '4', draft: 'olive oil' }, picks: { checked: ['1', '4'] } };
  expect(claudeCode.keysOf(drafted, ['1', 'basil'])).toEqual([
    'down',
    'down',
    'down',
    KILL,
    { _tag: 'text', text: 'basil' },
    'down',
    'enter',
  ]);
  expect(claudeCode.keysOf(ask, ['5'])).toEqual(chars('5'));
  expect(claudeCode.keysOf(ask, ['2', '5'])).toBeNull();
  expect(claudeCode.keysOf(ask, ['one', 'two'])).toBeNull();
});

const CLAUDE_REVIEW = [
  '─────────────────────────────────────────────────────────────',
  '←  ☒ Size  ☒ Extras  ✔ Submit  →',
  '',
  'Review your answers',
  '',
  ' ● Which size?',
  '   → Large',
  ' ● Which extras?',
  '   → Icon, Border',
  '',
  'Ready to submit your answers?',
  '',
  '❯ 1. Submit answers',
  '  2. Cancel',
  '',
] as const;

test('the review closing Claude’s questions is read as a choice whose prompt carries the answers, taken by its number', () => {
  const ask = claudeCode.screenAskOf(CLAUDE_REVIEW)!;
  expect(ask.prompt).toBe('Review your answers\n● Which size?\n→ Large\n● Which extras?\n→ Icon, Border\nReady to submit your answers?');
  expect(ask.options).toEqual([
    { value: '1', label: 'Submit answers' },
    { value: '2', label: 'Cancel' },
  ]);
  expect(ask.freeform).toBeUndefined();
  expect(claudeCode.keysOf(ask, ['1'])).toEqual(chars('1'));
});

test('a numbered markdown list without Claude’s pointer raises nothing', () => {
  expect(claudeCode.screenAskOf(['  1. Yes', '  2. No'])).toBeNull();
  expect(claudeCode.screenAskOf(['❯ some prompt'])).toBeNull();
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

const GEMINI_WIDGET = ['Allow this tool?', '● 1. Allow once', '  2. Allow for this session', '  3. No, suggest changes (esc)'] as const;

test('Gemini’s numbered confirmation is read as a choice carrying every option in the CLI’s own words', () => {
  expect(gemini.screenAskOf(GEMINI_WIDGET)).toEqual({
    kind: 'choice',
    prompt: 'Allow this tool?',
    header: null,
    subject: null,
    options: [
      { value: '1', label: 'Allow once' },
      { value: '2', label: 'Allow for this session' },
      { value: '3', label: 'No, suggest changes (esc)' },
    ],
    selected: '1',
  });
});

test('a numbered list without Gemini’s indicator raises nothing', () => {
  expect(gemini.screenAskOf(['  1. Allow once', '  2. Allow for this session'])).toBeNull();
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
  expect(gemini.screenAskOf(GEMINI_WIDGET.slice(0, -1))).toBeNull();
  expect(cursor.screenAskOf(CURSOR_WIDGET.slice(0, -1))).toBeNull();
  expect(claudeCode.screenAskOf(CLAUDE_WIDGET)?.options).toHaveLength(3);
  expect(gemini.screenAskOf(GEMINI_WIDGET)?.options).toHaveLength(3);
  expect(cursor.screenAskOf(CURSOR_WIDGET)?.options).toHaveLength(3);
});

const chars = (text: string): readonly HarnessWidgetKey[] => [...text].map((char) => ({ _tag: 'char', char }));

test('the numbered rows answer by typing the value’s own digits, cursor or none', () => {
  const rows = [
    { row: claudeCode, ask: claudeCode.screenAskOf(CLAUDE_WIDGET)!, value: '3' },
    { row: codex, ask: codex.screenAskOf(CODEX_WIDGET)!, value: '2' },
    { row: gemini, ask: gemini.screenAskOf(GEMINI_WIDGET)!, value: '3' },
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

test('Grok names no strokes at all', () => {
  const ask = devin.screenAskOf(WIDGET)!;
  expect(grok.keysOf(ask, ['1'])).toBeNull();
  expect(grok.cancelKeysOf(ask)).toBeNull();
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
