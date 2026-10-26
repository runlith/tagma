import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { extendPageToTurnRoot, pageOpensOnTurnRoot } from './page';
import type { ThreadTranscriptEntry, ThreadTranscriptPage } from './rows';
const user = (id: string): ThreadTranscriptEntry => ({ type: 'message', id, role: 'user', text: id });
const assistant = (id: string): ThreadTranscriptEntry => ({ type: 'message', id, role: 'assistant', text: id });
const tool = (id: string): ThreadTranscriptEntry => ({
  type: 'tool',
  id,
  runId: 'run-1',
  toolName: 'read',
  toolCallId: id,
  toolState: 'output-available',
});
test('speech, the frozen prompt or an empty page opens a turn; machinery alone does not', () => {
  expect(pageOpensOnTurnRoot([user('u-1'), assistant('a-1')])).toBe(true);
  expect(pageOpensOnTurnRoot([tool('t-1'), user('u-1')])).toBe(true);
  expect(pageOpensOnTurnRoot([assistant('a-1'), user('u-2')])).toBe(false);
  expect(pageOpensOnTurnRoot([tool('t-1'), assistant('a-1')])).toBe(false);
  expect(pageOpensOnTurnRoot([{ type: 'system-prompt', id: 'prompt', text: 'You are.' }, assistant('a-1')])).toBe(true);
  expect(pageOpensOnTurnRoot([])).toBe(true);
  expect(pageOpensOnTurnRoot([tool('t-1'), tool('t-2')])).toBe(false);
});
const pages = (answers: readonly ThreadTranscriptPage[]) => {
  const asked: number[] = [];
  return {
    asked,
    older: (before: number) => {
      asked.push(before);
      return Effect.succeed(answers[asked.length - 1] ?? { entries: [], before: null });
    },
  };
};
const budget = { entries: 200, bytes: 1024 * 1024 };
describe('carrying a page back to its turn', () => {
  it.effect(
    'a page already opening on a turn is served as it stands',
    Effect.fnUntraced(function* () {
      const { asked, older } = pages([]);
      const page = { entries: [user('u-1'), assistant('a-1')], before: 6 };
      expect(yield* extendPageToTurnRoot(page, older, budget)).toEqual({ page, pages: 0, stop: 'turn-root' });
      expect(asked).toEqual([]);
    }),
  );
  it.effect(
    'a page opening mid-answer takes older pages until one begins at a turn',
    Effect.fnUntraced(function* () {
      const { asked, older } = pages([
        { entries: [assistant('a-2')], before: 4 },
        { entries: [user('u-1'), assistant('a-1')], before: 2 },
      ]);
      const walk = yield* extendPageToTurnRoot({ entries: [assistant('a-3')], before: 6 }, older, budget);
      expect(asked).toEqual([6, 4]);
      expect(walk.page.entries.map((entry) => entry.id)).toEqual(['u-1', 'a-1', 'a-2', 'a-3']);
      expect(walk.page.before).toBe(2);
      expect({ pages: walk.pages, stop: walk.stop }).toEqual({ pages: 2, stop: 'turn-root' });
    }),
  );
  it.effect.each([
    ['a page reaching the transcript start', [assistant('a-1')]],
    ['an empty answer', []],
  ] as const)(
    '%s stops and carries its final cursor',
    Effect.fnUntraced(function* (_, entries) {
      const { asked, older } = pages([{ entries, before: null }]);
      const walk = yield* extendPageToTurnRoot({ entries: [assistant('a-2')], before: 6 }, older, budget);
      expect(asked).toEqual([6]);
      expect(walk).toEqual({ page: { entries: [...entries, assistant('a-2')], before: null }, pages: 1, stop: 'start' });
    }),
  );
  it.effect(
    'the extension spends its entry allowance and no more',
    Effect.fnUntraced(function* () {
      const { asked, older } = pages([
        { entries: [assistant('a-2'), assistant('a-3')], before: 5 },
        { entries: [assistant('a-4'), assistant('a-5')], before: 4 },
        { entries: [user('u-1')], before: null },
      ]);
      const walk = yield* extendPageToTurnRoot({ entries: [assistant('a-1')], before: 6 }, older, { entries: 2, bytes: budget.bytes });
      expect(asked).toEqual([6]);
      expect(walk.page.entries.map((entry) => entry.id)).toEqual(['a-2', 'a-3', 'a-1']);
      expect(walk.page.before).toBe(5);
      expect({ pages: walk.pages, stop: walk.stop }).toEqual({ pages: 1, stop: 'entry-budget' });
    }),
  );
  it.effect(
    'the byte allowance ends the extension the same way the count does',
    Effect.fnUntraced(function* () {
      const fat: ThreadTranscriptEntry = { type: 'message', id: 'a-2', role: 'assistant', text: 'x'.repeat(500) };
      const { asked, older } = pages([
        { entries: [fat], before: 5 },
        { entries: [user('u-1')], before: null },
      ]);
      const walk = yield* extendPageToTurnRoot({ entries: [assistant('a-1')], before: 6 }, older, { entries: budget.entries, bytes: 400 });
      expect(asked).toEqual([6]);
      expect(walk.page.entries.map((entry) => entry.id)).toEqual(['a-2', 'a-1']);
      expect({ pages: walk.pages, stop: walk.stop }).toEqual({ pages: 1, stop: 'byte-budget' });
    }),
  );
});
