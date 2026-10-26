import { describe, expect, test } from 'vitest';
import { transcriptCursorMessageId } from './transcriptCursor';

describe('assistant transcript cursor', () => {
  test('picks the message that crosses the reading line', () => {
    expect(
      transcriptCursorMessageId({
        items: [
          { bottom: 180, id: 'msg-1', top: 120 },
          { bottom: 260, id: 'msg-2', top: 190 },
        ],
        line: 200,
        viewportBottom: 400,
        viewportTop: 100,
      }),
    ).toBe('msg-2');
  });

  test('falls back to the nearest visible message when the line misses all boxes', () => {
    expect(
      transcriptCursorMessageId({
        items: [
          { bottom: 150, id: 'msg-1', top: 120 },
          { bottom: 260, id: 'msg-2', top: 220 },
        ],
        line: 190,
        viewportBottom: 400,
        viewportTop: 100,
      }),
    ).toBe('msg-2');
  });

  test('falls back through line order, first item, and previous cursor', () => {
    expect(
      transcriptCursorMessageId({
        items: [
          { bottom: 90, id: 'msg-1', top: 40 },
          { bottom: 120, id: 'msg-2', top: 95 },
        ],
        line: 200,
        viewportBottom: 400,
        viewportTop: 150,
      }),
    ).toBe('msg-2');

    expect(
      transcriptCursorMessageId({
        items: [{ bottom: 90, id: 'msg-1', top: 40 }],
        line: 20,
        viewportBottom: 300,
        viewportTop: 0,
      }),
    ).toBe('msg-1');

    expect(
      transcriptCursorMessageId({
        fallback: 'msg-fallback',
        items: [],
        line: 20,
        viewportBottom: 300,
        viewportTop: 0,
      }),
    ).toBe('msg-fallback');
  });
});
