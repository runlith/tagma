import { expect, test } from 'vitest';
import type { HostEnding } from '@tagma/server/installation/contract/wire/newHost';
import { endingGroups, endsSaid, namesAll } from './newHost.js';

let next = 0;
const ending = (activity: HostEnding['activity'], title: string, thread: string | null = null): HostEnding => ({
  execution: `e${(next += 1)}`,
  incarnation: 1,
  activity,
  title,
  projectId: 1,
  thread,
});

const spoken = (ends: readonly HostEnding[]): string =>
  endsSaid(ends)
    .map((part) => (part.strong ? `[${part.text}]` : part.text))
    .join('');

test('names at most three running programs and counts the rest by kind', () => {
  const ends = [
    ...['bun run dev', 'python manage.py runserver', 'claude', 'ssh build-box', 'vim plan.md'].map((title) => ending('program', title)),
    ...Array.from({ length: 15 }, () => ending('shell', 'zsh')),
    ...Array.from({ length: 3 }, () => ending('command', 'bun test', 'thread-1')),
  ];
  expect(spoken(ends)).toBe('[bun run dev], [python manage.py runserver], [claude] and 2 more, plus 15 idle shells and 3 agent commands');
  expect(namesAll(ends)).toBe(false);
  expect(endingGroups(ends).map((group) => [group.title, group.rows.length])).toEqual([
    ['Running', 5],
    ['Agent commands', 3],
    ['Idle shells', 15],
  ]);
});

test('a few running programs are all named, and an unread terminal is counted, never called idle', () => {
  expect(spoken([ending('program', 'bun run dev'), ending('program', 'claude', 'thread-1')])).toBe('[bun run dev] and [claude]');
  expect(namesAll([ending('program', 'bun run dev')])).toBe(true);
  expect(spoken([ending('unread', 'zsh'), ending('command', 'make', null)])).toBe('1 terminal and 1 command');
});
