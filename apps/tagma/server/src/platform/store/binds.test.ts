import { expect, test } from 'bun:test';
import { PAGE_TEXT, PAGE_VALUES, pagesOf } from './binds.js';

test('pages keep every row in order and never exceed the bound values or the page text, except a single row heavier than a page', () => {
  const columns = 4;
  const rows = Array.from({ length: PAGE_VALUES }, (_, at) => ({ at, text: at === 7 ? PAGE_TEXT + 1 : 100 }));
  const pages = pagesOf(rows, columns, (row) => row.text);
  expect(pages.flat()).toEqual(rows);
  for (const page of pages) {
    expect(page.length).toBeGreaterThan(0);
    expect(page.length * columns).toBeLessThanOrEqual(PAGE_VALUES);
    if (page.length > 1) expect(page.reduce((sum, row) => sum + row.text, 0)).toBeLessThanOrEqual(PAGE_TEXT);
  }
  expect(pages.find((page) => page.some((row) => row.at === 7))).toEqual(rows.filter((row) => row.at === 7));
});
