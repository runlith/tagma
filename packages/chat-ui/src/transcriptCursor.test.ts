import { describe, expect, test } from 'vitest';
import { READING_LINE_PX, readingLine } from './transcriptCursor';

describe('where the reading line stands in the feed', () => {
  test('it keeps its offset under the top until the last screen, then reaches the last pixel above the composer at the end', () => {
    const view = { scrollHeight: 5000, clientHeight: 600, clearance: 100 };
    const end = 5000 - 600;

    expect(readingLine({ ...view, scrollTop: 1000 })).toBe(1000 + READING_LINE_PX);
    expect(readingLine({ ...view, scrollTop: end - 500 })).toBe(end - 500 + READING_LINE_PX);
    expect(readingLine({ ...view, scrollTop: end - 250 })).toBe(end - 250 + (READING_LINE_PX + 499) / 2);
    expect(readingLine({ ...view, scrollTop: end })).toBe(end + 499);
  });
});
