import { expect, test } from 'bun:test';
import { builtinHarness } from '../testing/builtin.js';
import { typedBack, typedShape } from './input.js';

const frame = (text: string): readonly string[] => text.split('\n');

const RULE = '─'.repeat(40);
const footer = `  ➜  probe [Haiku 5.5]                                60415 tokens
  ⏵⏵ bypass permissions on (shift+tab to cycle)`;

const claudeWorking = frame(`  Bash(node -e "setTimeout(()=>console.log(1),40000)")
  ⎿  Running… (8s)
     (ctrl+b to run in background)

✶ Beboppin'… (10s · ↓ 102 tokens)

${RULE}
❯ Press up to edit queued messages
${RULE}
${footer}`);

const claudeInterrupted = frame(`⏺ Bash(node -e "setTimeout(()=>console.log(1),40000)")
  ⎿  Interrupted · What should Claude do instead?

${RULE}
❯
${RULE}
${footer}`);

const claudeReturned = frame(`✻ Brewed for 3s · done 6:16 PM

${RULE}
❯ first line
  second line
${RULE}
${footer}`);

const claudeDrafting = frame(`✶ Beboppin'… (10s · ↓ 102 tokens)

${RULE}
❯ my draft while working
${RULE}
${footer}`);

const claudePasted = frame(`${RULE}
❯ [Pasted text #2 +27 lines]
${RULE}
${footer}`);

test('Claude Code 2.1.306 is at its prompt when no spinner counts time, and its composer shows words in any phase', () => {
  const claude = builtinHarness('claude-code');
  const shown = claude.promptScreenOf!;
  const words = claude.composer!.of;
  expect([shown(claudeWorking), shown(claudeInterrupted), shown(claudeReturned)]).toEqual([false, true, true]);
  expect([words(claudeWorking), words(claudeInterrupted), words(claudeReturned), words(claudeDrafting), words(claudePasted)]).toEqual([
    null,
    null,
    'first line\nsecond line',
    'my draft while working',
    '[Pasted text #2 +27 lines]',
  ]);
});

test('a composer is Tagma’s own only when it shows words Tagma typed in that turn, verbatim or as the CLI’s collapsed paste of as many lines', () => {
  const typed = [typedShape('<input envelope="a" length="3" digest="d">\nWrite a poem\n</input>')];
  const wrapped = '<input envelope="a" length="3"\ndigest="d">\nWrite a poem\n</input>';
  expect(typedBack(wrapped, typed, 'breaks')).toBe(true);
  expect(typedBack('[Pasted text #4 +2 lines]', typed, 'breaks')).toBe(true);
  expect(typedBack('[Pasted text #4 +3 lines]', typed, 'lines')).toBe(true);
  expect(typedBack('[Pasted text #4 +3 lines]', typed, 'breaks')).toBe(false);
  expect(typedBack(`${wrapped} and my own words`, typed, 'breaks')).toBe(false);
  expect(typedBack('operator draft', typed, 'breaks')).toBe(false);
});
