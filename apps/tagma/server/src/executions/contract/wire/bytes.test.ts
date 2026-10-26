import { expect, test } from 'bun:test';
import { windowText } from './bytes.js';

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

test('a window that cut a character reads as text with the cut marked, and control bytes show', () => {
  const whole = new TextEncoder().encode('\u001b[32mok\u001b[0m ready ✓');
  expect(windowText(base64(whole.subarray(0, whole.length - 1)))).toEqual([
    "␛[32mok␛[0m ready ‹2 bytes starting a character the window's end cut, at byte 18 of the window›",
  ]);
  expect(windowText(base64(whole.subarray(whole.length - 2)))).toEqual(["‹2 bytes ending a character the window's start cut›"]);
});

test('a window mostly of bytes that are not UTF-8 reads as one line naming them', () => {
  expect(windowText(base64(Uint8Array.from([0xff, 0xfe, 0x41, 0xff])))).toEqual(['4 bytes, not text: read the document (json) for them']);
  expect(windowText(base64(new TextEncoder().encode('line one\nline two\n')))).toEqual(['line one', 'line two']);
});

test('overlong, surrogate and out-of-range sequences count as invalid bytes', () => {
  const ascii = (text: string) => [...new TextEncoder().encode(text)];
  const bytes = [...ascii('ok '), 0xc0, 0xaf, ...ascii(' '), 0xed, 0xa0, 0x80, ...ascii(' '), 0xf4, 0x90, 0x80, 0x80, ...ascii(' end')];
  expect(windowText(base64(Uint8Array.from(bytes)))).toEqual(['ok ‹2 invalid bytes› ‹3 invalid bytes› ‹4 invalid bytes› end']);
});
