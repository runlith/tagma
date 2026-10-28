import { describe, expect, test } from 'vitest';
import { READING_LINE_PX, readingLine } from './transcriptCursor';

describe('where the reading line stands in the feed', () => {
  test('it keeps its offset under the top until the last screen, then reaches the last pixel above the composer at the end', () => {
    const view = { scrollTop: 4000, clientHeight: 600, clearance: 100 };

    expect(readingLine({ ...view, endGap: 3000 })).toBe(4000 + READING_LINE_PX);
    expect(readingLine({ ...view, endGap: 500 })).toBe(4000 + READING_LINE_PX);
    expect(readingLine({ ...view, endGap: 250 })).toBe(4000 + (READING_LINE_PX + 499) / 2);
    expect(readingLine({ ...view, endGap: 0 })).toBe(4000 + 499);
  });

  test('in a visible height shorter than twice its offset it stands in the middle, above the composer', () => {
    expect(readingLine({ scrollTop: 0, clientHeight: 250, clearance: 100, endGap: 3000 })).toBe(75);
  });
});
