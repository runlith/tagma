import { expect, test } from 'bun:test';
import { cursorTerminal as cursor } from './cursor.js';

const WIDGET = [
  'Run this command?',
  '→ Run (once) (y)',
  '  Add … to allowlist? (tab)',
  '  Skip & tell the agent what to do instead (esc or n)',
] as const;

test('Cursor’s unnumbered decision carries the complete options the CLI drew', () => {
  expect(cursor.screenAskOf(WIDGET)).toEqual({
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
  expect(cursor.screenAskOf(['→ ordinary transcript', '  more text'])).toBeNull();
  expect(cursor.screenAskOf(WIDGET.slice(0, -1))).toBeNull();
  const loading = [...WIDGET.slice(0, -1), '  Checking Run Everything availability (loading)', WIDGET.at(-1)!];
  expect(cursor.screenAskOf(loading)).toBeNull();
  const resolved = loading.map((line) => line.replace('Checking Run Everything availability (loading)', 'Run Everything (shift+tab)'));
  expect(cursor.screenAskOf(resolved)?.options).toHaveLength(4);
});

test('Cursor walks the selected option and refuses a missing selection or unknown answer', () => {
  const ask = cursor.screenAskOf(WIDGET)!;
  const last = 'Skip & tell the agent what to do instead (esc or n)';
  expect(cursor.keysOf(ask, [last])).toEqual(['down', 'down', 'enter']);
  expect(cursor.keysOf(ask, ['Run (once) (y)'])).toEqual(['enter']);
  expect(cursor.keysOf({ ...ask, selected: last }, ['Add … to allowlist? (tab)'])).toEqual(['up', 'enter']);
  expect(cursor.keysOf({ ...ask, selected: null }, [last])).toBeNull();
  expect(cursor.keysOf(ask, ['Run Everything'])).toBeNull();
  expect(cursor.cancelKeysOf(ask)).toEqual(['esc']);
});

const frame = (text: string): readonly string[] => text.split('\n');
const footer = `  Auto                                                                                                  Run Everything
  ~/project`;

test('the Cursor composer reads drafts and queued words without its placeholder or working hint', () => {
  const words = cursor.composer!.of;
  const working = frame(`  $ node -e "setTimeout(()=>console.log(1),40000)" 5.7s
 ⠰⠰ Running  56 tokens

  → Add a follow-up                                                                                     ctrl+c to stop

${footer}`);
  const returned = frame(`  now face sudden scarcity or catastrophic overflow.

  → Write a 600 word essay about rivers, no tools

${footer}`);
  const armed = frame(`  → Add a follow-up

  Press Ctrl+C again to exit`);
  const lines = frame(`  → Add a follow-up
    second line
    third line

${footer}`);
  const queued = frame(`  follow-ups
  ○ Reply only QUEUED_MARK after this turn.
  enter steer · ↑ select/edit · esc cancel

  → Add a follow-up

${footer}`);
  const armedDraft = frame(`  → DRAFT_KEEP

  Press Ctrl+C again to exit`);
  expect([words(queued), words(armedDraft)]).toEqual(['Reply only QUEUED_MARK after this turn.', 'DRAFT_KEEP']);
  expect([words(working), words(returned), words(armed), words(lines)]).toEqual([
    null,
    'Write a 600 word essay about rivers, no tools',
    null,
    'Add a follow-up\nsecond line\nthird line',
  ]);
});
