import { expect, test } from 'bun:test';
import { MetadataInvalid } from '@runlith/tagma/adapter/metadata';
import { devin, devinTerminal as terminal } from './devin.js';

const WIDGET = [
  ' ⏺ Fetching https://wttr.in/Belgrade?format=%t+%C',
  '',
  '❭ 1 Yes  (Approve once)',
  '· 2 Yes, allow fetches to wttr.in/*',
  '· 3 Yes, always allow fetches to wttr.in/*',
  '· 4 Yes, always allow all web fetches',
  '· 5 Yes, switch to bypass mode',
  '· 6 No',
  '↑↓ select · ↵ confirm · esc cancel',
] as const;

test('an approval widget carries the invocation and all its choices', () => {
  expect(terminal.screenAskOf(WIDGET)).toEqual({
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

test('wrapped invocations remain whole and an unmeasured subject remains unknown', () => {
  const tail = ['', '❭ 1 Yes', '· 2 No', '↑↓ select · ↵ confirm · esc cancel'];
  expect(
    terminal.screenAskOf([
      ' ⏺ Running command: npm run build --workspace=apps/tagma/server --silent -- --reporter=do',
      'ts --max-warnings=0',
      ...tail,
    ])?.prompt,
  ).toBe('Running command: npm run build --workspace=apps/tagma/server --silent -- --reporter=dots --max-warnings=0');
  expect(terminal.screenAskOf(['⏺ Running command: git push origin main', ...tail])?.subject).toBe('git push origin main');
  expect(terminal.screenAskOf(['Waiting for your answer', ...tail])).toMatchObject({
    prompt: 'Waiting for your answer',
    subject: null,
  });
});

test('answer keys walk the current cursor and refuse unavailable choices', () => {
  const ask = terminal.screenAskOf(WIDGET)!;
  expect(terminal.keysOf(ask, ['5'])).toEqual(['down', 'down', 'down', 'down', 'enter']);
  expect(terminal.keysOf(ask, ['1'])).toEqual(['enter']);
  expect(terminal.keysOf({ ...ask, selected: '4' }, ['2'])).toEqual(['up', 'up', 'enter']);
  expect(terminal.keysOf(ask, ['7'])).toBeNull();
  expect(terminal.keysOf({ ...ask, selected: null }, ['2'])).toBeNull();
  expect(terminal.cancelKeysOf(ask)).toEqual(['esc']);
});

test('an incomplete widget is not an answerable question', () => {
  const undrawn = WIDGET.map((line) => (line.startsWith('❭ 1') ? line.replace('❭', '·') : line));
  expect(terminal.screenAskOf(undrawn)).toMatchObject({ selected: null, options: expect.arrayContaining([{ value: '6', label: 'No' }]) });
  expect(terminal.screenAskOf([WIDGET[0], '', ...WIDGET.slice(4)])).toBeNull();
  expect(terminal.screenAskOf(WIDGET.slice(0, -1))).toBeNull();
});

const RULE = '─'.repeat(40);
const frame = (text: string) => text.split('\n');
const idle = frame(`${RULE} (bypass permissions on) ─
❭ Ask Devin to build features, fix bugs, or work on your code
${RULE}
SWE-1.6 Slow`);
const working = frame(`⠀⠙ Running tools · 6s (esc twice to interrupt)
${RULE} (bypass permissions on) ─
❭ Guide Devin while it works
${RULE}
SWE-1.6 Slow`);
const drafting = frame(`⠤⠄ Running tools · 10s (esc twice to interrupt)
${RULE} (bypass permissions on) ─
❭ my draft while working
  second line
${RULE}
SWE-1.6 Slow`);

test('the composer reads drafted words and distinguishes the idle prompt', () => {
  expect([idle, working, drafting].map(terminal.composer!.of)).toEqual([null, null, 'my draft while working\nsecond line']);
  expect([idle, working, drafting].map(terminal.promptScreenOf!)).toEqual([true, false, false]);
});

test('hook answers use the permission and additional-context envelopes', () => {
  const codec = terminal.hooks!.codec;
  expect(JSON.parse(codec.permission({ allowed: true, words: 'allow the call' }))).toEqual({
    decision: 'approve',
    reason: 'allow the call',
  });
  expect(JSON.parse(codec.permission({ allowed: false, words: 'deny the call' }))).toEqual({ decision: 'deny', reason: 'deny the call' });
  expect(JSON.parse(codec.context('the law'))).toEqual({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'the law' },
  });
  expect(JSON.parse(codec.tool('read these lines', 'after'))).toEqual({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'read these lines' },
  });
  expect(codec.prompt).toBeNull();
});

test('exports and session listings preserve identity and recorded claims', () => {
  const reader = terminal.metadata!;
  const sources = (rootKey: string) => reader.sources({ rootKey, cwd: '/work', storage: { entries: [] }, exportPath: '/export.json' });
  const source = sources('clumsy-tower')[0]!;
  if (source.kind !== 'file') throw new Error('expected export file');
  const atif = JSON.stringify({ schema_version: 'ATIF-v1.7', session_id: 'clumsy-tower', agent: { model_name: 'SWE-2 Max' } });
  expect(source.fold.line(source.fold.empty(), atif).model).toMatchObject({ value: 'SWE-2 Max', claim: 'last-recorded' });
  const foreign = sources('other')[0]!;
  if (foreign.kind !== 'file') throw new Error('expected export file');
  expect(() => foreign.fold.line(foreign.fold.empty(), atif)).toThrow(MetadataInvalid);
  const listing = sources('clumsy-tower')[1]!;
  if (listing.kind !== 'command') throw new Error('expected session listing');
  expect(
    listing.parse(
      JSON.stringify([
        { id: 'uuid-one', short_id: 'clumsy-tower', title: 'One' },
        { id: 'uuid-two', short_id: 'other', title: 'Two' },
      ]),
    )?.value,
  ).toBe('One');
  expect(() =>
    listing.parse(
      JSON.stringify([
        { id: 'clumsy-tower', title: 'One' },
        { id: 'uuid-two', short_id: 'clumsy-tower', title: 'Two' },
      ]),
    ),
  ).toThrow(MetadataInvalid);
});

test('reader words come only from user steps of the named ATIF session', () => {
  const source = terminal.metadata!.words!.sources({
    rootKey: 'devin-1',
    cwd: '/work',
    storage: { entries: [] },
    exportPath: '/export.json',
  })[0]!;
  const text = (session_id: string) =>
    JSON.stringify({
      schema_version: 'ATIF-v1.7',
      session_id,
      steps: [
        { source: 'user', message: 'fix the black gap under the terminal' },
        { source: 'user', message: [{ type: 'text', text: 'and pin the footer' }] },
        { source: 'agent', message: 'working on it' },
        { source: 'user', message: '<command-name>init</command-name>' },
        { source: 'system', message: 'you are Devin' },
      ],
    });
  expect(source.fold.line(source.fold.empty(), text('devin-1')).said.flatMap((said) => said.typed)).toEqual([
    'fix the black gap under the terminal',
    'and pin the footer',
  ]);
  expect(() => source.fold.line(source.fold.empty(), text('other'))).toThrow(MetadataInvalid);
});

test('ATIF final answers end a turn, a system interrupt aborts it, and a tool wait stays open', () => {
  const reader = terminal.metadata!.ends!.reader;
  const step = (source: string, message: string, calls = 0) => ({ source, message, tool_calls: Array.from({ length: calls }, () => ({})) });
  expect(reader.judge([step('agent', 'BANANA'), step('agent', 'looking', 1), step('user', 'go')], true, null)).toEqual({
    _tag: 'Completed',
    message: 'BANANA',
  });
  expect(reader.judge([step('system', '[Response interrupted by user]'), step('agent', 'partial')], true, null)).toEqual({
    _tag: 'Aborted',
  });
  expect(reader.judge([step('agent', 'waiting', 1), step('user', 'go')], true, null)).toEqual({ _tag: 'Open' });
});

test('launches preserve permission, model and session addressing on each transport', () => {
  const launch = terminal.launch;
  const choice = { model: 'claude-opus-5-xhigh', rung: null };
  expect(launch.interactive('go', choice)).toEqual([
    'devin',
    '--permission-mode',
    'dangerous',
    '--respect-workspace-trust',
    'false',
    '--model',
    choice.model,
    '--',
    'go',
  ]);
  expect(launch.root(launch.resume('root-3', 'go', choice))).toBe('root-3');
  expect(launch.export!(launch.interactive('go'), '/export.json')).toEqual([
    'devin',
    '--permission-mode',
    'dangerous',
    '--respect-workspace-trust',
    'false',
    '--export',
    '/export.json',
    '--',
    'go',
  ]);
  expect(() => launch.interactive('go', { model: 'gpt-6.1-sol', rung: 'high' })).toThrow(/rung/);
  expect(devin.acp!.argv(choice)).toEqual(['devin', 'acp', '--model', choice.model]);
  expect(devin.acp!.configure(choice, {})).toEqual([{ configId: 'model', value: choice.model }]);
});
