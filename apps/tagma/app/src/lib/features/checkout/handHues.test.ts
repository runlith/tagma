import { expect, test } from 'vitest';
import { handHues } from './handHues.js';

const thread = (threadId: string) => ({ threadId });

test('a thread keeps its colour whatever company it stands in', () => {
  const alone = handHues([thread('01a09369-fea6-7315-8eff-2c17ad90083d')]);
  const crowded = handHues([thread('01a0975c-4574-78ac-b553-0cab76da9706'), thread('01a09369-fea6-7315-8eff-2c17ad90083d')]);

  expect(crowded.get('01a09369-fea6-7315-8eff-2c17ad90083d')).toBe(alone.get('01a09369-fea6-7315-8eff-2c17ad90083d'));
});

test('two threads that want one hue take two, while a hue is free', () => {
  const ids = Array.from({ length: 40 }, (_unused, at) => `01a0${at.toString(16).padStart(4, '0')}-thread`);
  const alone = new Map(ids.map((id) => [id, handHues([thread(id)]).get(id)]));
  const pair = ids.flatMap((one) => ids.filter((two) => two > one && alone.get(one) === alone.get(two)).map((two) => [one, two]));
  expect(pair.length).toBeGreaterThan(0);

  const [first, second] = pair[0] as [string, string];
  const both = handHues([thread(first), thread(second)]);
  expect(both.get(first)).not.toBe(both.get(second));
  expect(both.get(first)).toBe(alone.get(first));
});

test('a file with more hands than hues spends them all before doubling any', () => {
  const many = Array.from({ length: 6 }, (_unused, at) => thread(`hand-${at}`));
  const hues = handHues(many);

  expect(new Set([...hues.values()]).size).toBe(4);
  expect(hues.size).toBe(6);
});
