import { expect, test } from 'bun:test';
import { builtinHarness } from '../testing/builtin.js';
import { typedBack, typedShape } from './input.js';

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

const codexDrafting = frame(`› Run the shell command: node -e "setTimeout(()=>{},20000)" and then say DONE

• I’ll run the command and wait for it to finish.

Working (10s • esc to interrupt) · Running hooks

› my draft while working
  second line

  GPT-6.1-Sol low · Context 100% left
  tab to queue message`);

const devinIdle = frame(`${RULE} (bypass permissions on) ─
❭ Ask Devin to build features, fix bugs, or work on your code
${RULE}
SWE-1.6 Slow                                                                    Use /clear to start a fresh conversation`);

const devinWorking = frame(`⠀⠙ Running tools · 6s (esc twice to interrupt)
${RULE} (bypass permissions on) ─
❭ Guide Devin while it works
${RULE}
SWE-1.6 Slow`);

const devinDrafting = frame(`⠤⠄ Running tools · 10s (esc twice to interrupt)
${RULE} (bypass permissions on) ─
❭ my draft while working
  second line
${RULE}
SWE-1.6 Slow`);

const grokBox = (inside: string): readonly string[] =>
  frame(`  ⠸ Run Node setTimeout for 20 seconds… 4.5s                         7.3s ⇣26.2k [↓][stop]
 ╭${'─'.repeat(60)}╮
${inside}
 ╰${'─'.repeat(30)} Grok 4.5 (low) · always-approve ─╯
 Ctrl+x:shortcuts`);

test('Codex 0.162.0, Devin 3000.11.92 and Grok Build 1.0.62 composers read the words standing in them, idle or working, and nothing for a placeholder', () => {
  const codex = builtinHarness('codex').composer!.of;
  const devin = builtinHarness('devin').composer!.of;
  const grok = builtinHarness('grok').composer!.of;
  expect([
    codex(idle),
    codex(working),
    codex(codexDrafting),
    codex(frame('› first\n\n  second\n\n  GPT-6.1-Sol low\n  ? for shortcuts')),
  ]).toEqual([null, 'draft stays', 'my draft while working\nsecond line', 'first\n\nsecond']);
  expect([devin(devinIdle), devin(devinWorking), devin(devinDrafting)]).toEqual([null, null, 'my draft while working\nsecond line']);
  expect([grok(grokBox(` │ ❯${' '.repeat(57)}│`)), grok(grokBox(` │ ❯ hello draft[Pasted: 3 lines]${' '.repeat(28)}│`))]).toEqual([
    null,
    'hello draft[Pasted: 3 lines]',
  ]);
});

const cursorFooter = `  Auto                                                                                                  Run Everything
  ~/project`;

const cursorWorking = frame(`  $ node -e "setTimeout(()=>console.log(1),40000)" 5.7s
 ⠰⠰ Running  56 tokens

  → Add a follow-up                                                                                     ctrl+c to stop

${cursorFooter}`);

const cursorReturned = frame(`  now face sudden scarcity or catastrophic overflow.

  → Write a 600 word essay about rivers, no tools

${cursorFooter}`);

const cursorArmed = frame(`  → Add a follow-up

  Press Ctrl+C again to exit`);

const cursorLines = frame(`  → Add a follow-up
    second line
    third line

${cursorFooter}`);

test('the Cursor Agent 2026.10.01 composer reads words other than its placeholder on any of its lines, and its working hint is no word', () => {
  const words = builtinHarness('cursor').composer!.of;
  const queued = frame(`  follow-ups
  ○ Reply only QUEUED_MARK after this turn.
  enter steer · ↑ select/edit · esc cancel

  → Add a follow-up

${cursorFooter}`);
  const armedDraft = frame(`  → DRAFT_KEEP

  Press Ctrl+C again to exit`);
  expect([words(queued), words(armedDraft)]).toEqual(['Reply only QUEUED_MARK after this turn.', 'DRAFT_KEEP']);
  expect([words(cursorWorking), words(cursorReturned), words(cursorArmed), words(cursorLines)]).toEqual([
    null,
    'Write a 600 word essay about rivers, no tools',
    null,
    'Add a follow-up\nsecond line\nthird line',
  ]);
});

test('the Codex 0.159.0 composer placeholder with no working indicator is the returned prompt; a working or drafted screen is not', () => {
  const shown = builtinHarness('codex').promptScreenOf!;
  expect(shown(idle)).toBe(true);
  expect(shown(working)).toBe(false);
  expect(shown(frame('› draft stays\n\n  ? for shortcuts'))).toBe(false);
});
