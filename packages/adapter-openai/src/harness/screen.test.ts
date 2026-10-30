import { expect, test } from 'bun:test';
import { codexTerminal as codex } from './codex.js';

const WIDGET = [
  'Allow this command?',
  '› 1. Yes, just this once (y)',
  "  2. Yes, and don't ask again (a)",
  '  3. No (n)',
  'Press enter to confirm or esc to cancel',
] as const;

const frame = (text: string): readonly string[] => text.split('\n');
const idle = frame(`  ↳ Recap: The draft is ready.

• Follow-up response.


› Ask Codex to do anything

  gpt-test default · /tmp/project
  ? for shortcuts`);
const working = frame(`⚠ Heads up, you have less than 5% of your 5h limit left. Run /status for a
  breakdown.

• Working (0s • esc to interrupt)

› draft stays

  GPT-5.6-Sol default · /tmp/project
  tab to queue message`);
const drafting = frame(`› Run the shell command: node -e "setTimeout(()=>{},20000)" and then say DONE

• I’ll run the command and wait for it to finish.

Working (10s • esc to interrupt) · Running hooks

› my draft while working
  second line

  GPT-6.1-Sol low · Context 100% left
  tab to queue message`);

test('Codex’s overlay carries every option and answers by its own digits, cursor or none', () => {
  const ask = codex.screenAskOf(WIDGET)!;
  expect(ask).toEqual({
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
  expect(codex.keysOf(ask, ['2'])).toEqual([{ _tag: 'char', char: '2' }]);
  expect(codex.keysOf({ ...ask, selected: null }, ['2'])).toEqual([{ _tag: 'char', char: '2' }]);
  expect(codex.keysOf(ask, ['9'])).toBeNull();
  expect(codex.cancelKeysOf(ask)).toEqual(['esc']);
  expect(codex.screenAskOf(['$ git push origin main', ...WIDGET.slice(1)])?.subject).toBe('git push origin main');
});

test('Codex without its footer, or with a half-drawn list, raises nothing', () => {
  expect(codex.screenAskOf(WIDGET.filter((line) => !line.startsWith('Press')))).toBeNull();
  expect(codex.screenAskOf(['Allow this command?', '  2. Yes', '  3. No', 'Press enter to confirm or esc to cancel'])).toBeNull();
});

test('the composer reads standing words, idle or working, and no placeholder', () => {
  const words = codex.composer!.of;
  expect([
    words(idle),
    words(working),
    words(drafting),
    words(frame('› first\n\n  second\n\n  GPT-6.1-Sol low\n  ? for shortcuts')),
  ]).toEqual([null, 'draft stays', 'my draft while working\nsecond line', 'first\n\nsecond']);
});

test('the composer placeholder without a working indicator is the returned prompt', () => {
  const shown = codex.promptScreenOf!;
  expect(shown(idle)).toBe(true);
  expect(shown(working)).toBe(false);
  expect(shown(frame('› draft stays\n\n  ? for shortcuts'))).toBe(false);
});
