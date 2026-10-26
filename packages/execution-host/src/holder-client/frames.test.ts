import { expect, test } from 'bun:test';
import { decode } from './frames';

const pacedBody = (outcomes: ReadonlyArray<number>): Uint8Array => {
  const body = new Uint8Array(9 + outcomes.length);
  const view = new DataView(body.buffer);
  body[0] = 135;
  view.setUint32(1, 7, true);
  view.setUint32(5, outcomes.length, true);
  body.set(outcomes, 9);
  return body;
};

test('a pace answer for many processes reads every outcome', () => {
  const outcomes = Array.from({ length: 12 }, (_, index) => index % 2);
  expect(decode(pacedBody(outcomes))).toEqual({
    _tag: 'paced',
    request: 7,
    kept: outcomes.map((kind) => ({ _tag: kind === 0 ? 'held' : 'moved' })),
  });
});
