import { expect, test } from 'bun:test';
import { messageOf, subjectFor } from './message.js';

const tasks = [
  { name: 'ab12cd34', title: 'first task', stealth: false },
  { name: 'cd34ef56', title: 'second task', stealth: false },
];

const CO = 'Co-authored-by: Tagma <agent@tagma.app>';

test('a commit keeps the subject and body as written and closes on one trailer block of its tasks and Tagma', () => {
  expect(messageOf('fix(landing): keep the result', 'Keep the detail.', tasks, true)).toBe(
    `fix(landing): keep the result\n\nKeep the detail.\n\nTask: ab12cd34 first task\nTask: cd34ef56 second task\n${CO}`,
  );
  expect(messageOf('fix the result (ab12cd34)', undefined, [], false)).toBe('fix the result (ab12cd34)');
  expect(messageOf('fix the result', '  ', tasks.slice(0, 1), false)).toBe('fix the result\n\nTask: ab12cd34 first task');
});

test('a body ending in trailers takes the added ones into the same block, once each', () => {
  expect(messageOf('fix the result', `Keep the detail.\n\nSigned-off-by: A <a@a>\n${CO}\n`, tasks.slice(0, 1), true)).toBe(
    `fix the result\n\nKeep the detail.\n\nSigned-off-by: A <a@a>\n${CO}\nTask: ab12cd34 first task`,
  );
  expect(messageOf('fix the result', 'Keep it.\n\nSigned-off-by :A <a@a>\n# kept by cleanup', [], true)).toBe(
    `fix the result\n\nKeep it.\n\nSigned-off-by :A <a@a>\n# kept by cleanup\n${CO}`,
  );
  expect(messageOf('fix: one line: with a colon', undefined, [], true)).toBe(`fix: one line: with a colon\n\n${CO}`);
});

test('a commit message names no stealth task, neither in a trailer nor by its title', () => {
  const kept = { name: 'ef56ab78', title: 'the vendor deal', stealth: true };
  expect(messageOf('fix the result', undefined, [kept], false)).toBe('fix the result');
  expect(subjectFor(undefined, [kept])).toBe('the changes of one session');
  expect(subjectFor(' \t', [])).toBe('the changes of one session');
});
