import { expect, test } from 'bun:test';
import type { HarnessWidgetKey, ScreenAsk } from '@runlith/tagma/adapter/harness';
import { claudeTerminal as claudeCode } from './claudeCode.js';

const chars = (text: string): readonly HarnessWidgetKey[] => [...text].map((char) => ({ _tag: 'char', char }));

const asked = (ask: ScreenAsk) => ({
  kind: ask.kind,
  prompt: ask.prompt,
  header: ask.header,
  options: ask.options.map(({ value, label }) => ({ value, label })),
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
  expect(asked(pointedLower)).toEqual(asked(ask));
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
  expect(asked(drafted)).toEqual(asked(ask));
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
