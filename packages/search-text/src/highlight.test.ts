import { expect, test } from 'bun:test';
import { snippetOf, stemsOf } from './highlight.js';

function marked(text: string, query: string, width = 240): string[] {
  const { snippet, highlights } = snippetOf(text, stemsOf(query), width);
  return highlights.map((span) => snippet.slice(span.start, span.end));
}

test('another form of a query word is marked by its stem, in Russian and English', () => {
  expect(marked('Поедем в Черногорию летом', 'Черногория')).toEqual(['Черногор']);
  expect(marked('two trips, one trip', 'trips')).toEqual(['trip', 'trip']);
});

test('an unspaced word and a diacritic are marked as written', () => {
  expect(marked('我想去黑山旅游', '黑山')).toEqual(['黑山']);
  expect(marked('a café on the corner', 'cafe')).toEqual(['café']);
});

test('a long text is cut to the width around the first match, with spans relative to the cut', () => {
  const text = `${'filler '.repeat(100)}Montenegro${' filler'.repeat(100)}`;
  const { snippet, highlights } = snippetOf(text, stemsOf('montenegro'), 100);
  expect(snippet.length).toBe(100);
  expect(highlights).toHaveLength(1);
  const [span] = highlights;
  expect(snippet.slice(span?.start, span?.end)).toBe('Montenegro');
});
