import { expect, test } from 'bun:test';
import { messageOf } from './message.js';

const tasks = [
  { name: 'ab12cd34', title: 'first task' },
  { name: 'cd34ef56', title: 'second task' },
];

test('a commit message carries its tasks on the subject and preserves its body', () => {
  for (const newline of ['\n', '\r\n']) {
    const body = `${newline}${newline}Preserve the detail.${newline}${newline}And the final paragraph.`;
    expect(messageOf(`Fix the result${body}`, tasks)).toBe(`Fix the result (ab12cd34, cd34ef56)${body}`);
  }
  expect(messageOf('Fix the result', tasks)).toBe('Fix the result (ab12cd34, cd34ef56)');
  expect(messageOf('Fix the result\n\nPreserve the detail.', [])).toBe('Fix the result\n\nPreserve the detail.');
});

test('task names already on the subject merge with the held ones once, in any case and id length', () => {
  const held = tasks.slice(0, 1);
  expect(messageOf('the work (AB12CD34)', held)).toBe('the work (ab12cd34)');
  expect(messageOf('the work (cd34ef56, 000000000000000000000000ab12cd34) (ab12cd34)\n\nbody', held)).toBe(
    'the work (cd34ef56, ab12cd34)\n\nbody',
  );
  expect(messageOf('the work (reviewed)', held)).toBe('the work (reviewed) (ab12cd34)');
});
