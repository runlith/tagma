import { expect, test } from 'bun:test';
import { framed, PART_CHARS } from './channel.js';

test('a report cut into parts never splits a character, so each part survives a text frame', () => {
  const report = { kind: 'cdp', seq: 1, session: 1 } as const;
  const head = `${JSON.stringify(report)}\n`;
  const tail = `${'a'.repeat(PART_CHARS - head.length - 1)}😀${'b'.repeat(10)}`;
  const [count, ...parts] = framed(report, tail);
  expect(JSON.parse(count!)).toEqual({ parts: 2 });
  expect(parts.every((part) => part.isWellFormed())).toBe(true);
  expect(parts.join('')).toBe(head + tail);
});
