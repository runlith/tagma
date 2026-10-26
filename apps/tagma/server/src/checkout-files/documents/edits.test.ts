import { expect, test } from 'bun:test';
import { Result } from 'effect';
import { applyLineEdits } from '@runlith/files/lines';
import { lineEdits } from './edits.js';

test('any text followed by any other is sent as line edits that rebuild it exactly, the empty file and the final line break included', () => {
  const texts = ['', 'a', 'a\n', 'a\nb', 'a\nb\n', '\na', 'x\ry\n', 'x\ry\nz\r'];
  for (const before of texts) {
    for (const after of texts) {
      const edits = lineEdits(before, after);
      expect([before, after, edits === null ? null : Result.getOrThrow(applyLineEdits(before, edits))]).toEqual([before, after, after]);
    }
  }
});
