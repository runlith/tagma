import { describe, expect, test } from 'bun:test';
import { sha256 as portable } from './sha256';
import { sha256 as native } from './sha256.node';

const inputs: ReadonlyArray<ReadonlyArray<string | Uint8Array>> = [
  [],
  ['abc'],
  ['a'.repeat(55)],
  ['a'.repeat(56)],
  ['a'.repeat(64)],
  ['b'.repeat(119), 'c'],
  ['x'.repeat(10), 'y'.repeat(200), 'z'.repeat(64), ''],
  ['héllo — ', '日本語 ', '🙂'],
  [new Uint8Array(1_000).map((_, index) => index % 251), 'tail'],
];

describe('the portable sha256 answers what the platform digest answers', () => {
  test('copies preserve a partial block and continue independently without replaying its prefix', () => {
    const prefix = 'prefix 日本語 '.repeat(9);
    for (const make of [portable, native]) {
      const original = make().update(prefix);
      const first = original.copy().update('first');
      const second = original.copy().update('second');
      expect(first.digest('hex')).toBe(native().update(prefix).update('first').digest('hex'));
      expect(second.digest('hex')).toBe(native().update(prefix).update('second').digest('hex'));
      expect(original.digest('hex')).toBe(native().update(prefix).digest('hex'));
    }
  });

  for (const parts of inputs) {
    test(`${parts.length} parts, ${parts.reduce((total, part) => total + part.length, 0)} units`, () => {
      for (const encoding of ['hex', 'base64url'] as const) {
        const ours = portable();
        const theirs = native();
        for (const part of parts) {
          ours.update(part);
          theirs.update(part);
        }
        expect(ours.digest(encoding)).toBe(theirs.digest(encoding));
      }
    });
  }
});
