import { expect, test } from 'bun:test';
import { claudeTerminal } from './claudeCode.js';

const frame = (text: string): readonly string[] => text.split('\n');
const rule = '─'.repeat(40);
const footer = `  ➜  probe [Haiku 5.5]                                60415 tokens
  ⏵⏵ bypass permissions on (shift+tab to cycle)`;

const working = frame(`  Bash(node -e "setTimeout(()=>console.log(1),40000)")
  ⎿  Running… (8s)
     (ctrl+b to run in background)

✶ Beboppin'… (10s · ↓ 102 tokens)

${rule}
❯ Press up to edit queued messages
${rule}
${footer}`);

const interrupted = frame(`⏺ Bash(node -e "setTimeout(()=>console.log(1),40000)")
  ⎿  Interrupted · What should Claude do instead?

${rule}
❯
${rule}
${footer}`);

const returned = frame(`✻ Brewed for 3s · done 6:16 PM

${rule}
❯ first line
  second line
${rule}
${footer}`);

const drafting = frame(`✶ Beboppin'… (10s · ↓ 102 tokens)

${rule}
❯ my draft while working
${rule}
${footer}`);

const pasted = frame(`${rule}
❯ [Pasted text #2 +27 lines]
${rule}
${footer}`);

test('Claude Code 2.1.306 is at its prompt when no spinner counts time, and its composer shows words in any phase', () => {
  const shown = claudeTerminal.promptScreenOf!;
  const words = claudeTerminal.composer!.of;
  expect([shown(working), shown(interrupted), shown(returned)]).toEqual([false, true, true]);
  expect([words(working), words(interrupted), words(returned), words(drafting), words(pasted)]).toEqual([
    null,
    null,
    'first line\nsecond line',
    'my draft while working',
    '[Pasted text #2 +27 lines]',
  ]);
});
