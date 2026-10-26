import { expect, test } from 'bun:test';
import { distance, match, pieces, rank } from './match.js';

const COMMANDS = [
  { name: 'new', description: 'Start a new thread' },
  { name: 'compact', description: 'Summarize the conversation to free context' },
  { name: 'mode', description: 'What this thread may do without asking' },
  { name: 'model', description: 'What this thread thinks with' },
  { name: 'refresh-instructions', description: 'Read the current instructions on the next turn' },
  { name: 'delegation', description: 'Whether agents here may start other agents' },
  { name: 'agent', description: 'Which agent definition this thread runs' },
];

const names = (query: string): readonly string[] =>
  rank(COMMANDS, query, (command) => ({ name: command.name, text: [command.description] })).map(({ item }) => item.name);

test('the exact name leads, then prefixes, initials and scattered letters, then typos, then words of the description', () => {
  expect(names('mode')).toEqual(['mode', 'model']);
  expect(names('ri')[0]).toBe('refresh-instructions');
  expect(names('delg')).toEqual(['delegation']);
  expect(names('compcat')).toEqual(['compact']);
  expect(names('agents')).toEqual(['agent', 'delegation']);
  expect(names('free')).toEqual(['compact']);
  expect(names('')).toEqual(COMMANDS.map((command) => command.name));
});

test('a typo is forgiven once from four letters and twice from eight, never in a shorter word', () => {
  expect(names('mdoe')).toEqual(['mode', 'model']);
  expect(names('delagatoin')).toEqual(['delegation']);
  expect(names('nwe')).toEqual([]);
  expect(distance('tset', 'test', 1)).toBe(1);
  expect(distance('tset', 'settings', 2)).toBeNull();
});

test('a name typed whole, word by word, leads the same words in another order', () => {
  const ranked = rank(['Bar Foo', 'Foo Bar'], 'foo bar', (name) => ({ name }));
  expect(ranked.map(({ item }) => item)).toEqual(['Foo Bar', 'Bar Foo']);
  expect(ranked.map(({ hit }) => hit.exact)).toEqual([true, false]);
});

test('letters compare by what they are, not by their encoding', () => {
  expect(match('搜索', { name: '实现搜索功能', prose: true })).not.toBeNull();
  expect(match('é', { name: 'é' })?.exact).toBe(true);
  expect(match('ος', { name: 'ΟΣ' })).not.toBeNull();
  expect(match('\u{1F600}', { name: '\u{1F603}\u{1F200}' })).toBeNull();
  const emoji = match('\u{1F600}', { name: 'a\u{1F600}b' });
  expect(pieces('a\u{1F600}b', emoji?.positions ?? []).filter((piece) => piece.hit)).toEqual([{ text: '\u{1F600}', hit: true }]);
});

test('the matched letters of the name are marked through case, diacritics and separators the query skipped', () => {
  expect(match('cafe', { name: 'Café menu' })?.positions).toEqual([0, 1, 2, 3]);
  const joined = match('gpt55', { name: 'GPT-5.5 Sol' });
  expect(joined?.positions).toEqual([0, 1, 2, 4, 6]);
  expect(joined?.loose).toBe(false);
  expect(match('ek', { name: 'Muse Spark' })?.loose).toBe(true);
});
