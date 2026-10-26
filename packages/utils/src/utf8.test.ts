import { expect, test } from 'bun:test';
import { utf8ByteLength, utf8Order } from './utf8';

test('the UTF-8 length of a string is the length its encoding has, lone surrogates as a replacement character', () => {
  const encoder = new TextEncoder();
  for (const text of ['', 'ascii', 'héllo', '日本語', '🙂 ok', '\ud83d', 'a\udc00b', '\ud83d\ud83d\ude42', 'x'.repeat(1000)]) {
    expect(utf8ByteLength(text)).toBe(encoder.encode(text).byteLength);
  }
});

test('text orders as its UTF-8 bytes do, astral characters after the last BMP ones', () => {
  const words = ['b', 'B', 'a', 'é', 'ﬀ', '😀', 'ab', '', '\uffff', 'Я', 'я'];
  const bytewise = [...words].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  expect([...words].sort(utf8Order)).toEqual(bytewise);
});
