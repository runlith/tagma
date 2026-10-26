import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { sha256Batch } from '@runlith/utils/sha256';

const encoder = new TextEncoder();

test('asynchronous SHA batches preserve bytes, digest order and independent callers', async () => {
  const batches = [
    [new Uint8Array(), encoder.encode('abc'), encoder.encode('héllo — 日本語 🙂')],
    [new Uint8Array([0, 255, 7, 9]), encoder.encode('another request')],
    [],
  ];
  const before = batches.map((parts) => parts.map((part) => [...part]));
  const expected = batches.map((parts) => parts.map((part) => createHash('sha256').update(part).digest('hex')));
  const actual = await Promise.all(batches.map((parts) => sha256Batch(parts)));
  expect(actual).toEqual(expected);
  expect(batches.map((parts) => parts.map((part) => [...part]))).toEqual(before);
});
