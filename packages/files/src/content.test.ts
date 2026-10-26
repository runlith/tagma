import { describe, expect, test } from 'bun:test';
import { contentDigest, contentOf, looksBinaryText, windowMatches, withBom } from './content';

describe('content digests', () => {
  test('stay the sha256 prefix every stored hash was written with', () => {
    expect(contentDigest('')).toBe('e3b0c44298fc1c14');
    expect(contentDigest('export const value = 1;\n')).toBe('5d8f65d2774e206b');
  });
});

describe('a window matches whole lines only', () => {
  test('an empty window matches only an empty text', () => {
    expect(windowMatches('', '')).toEqual([0]);
    expect(windowMatches('a\n', '')).toEqual([]);
  });

  test('a match must open a line and close one or the text', () => {
    expect(windowMatches('xa\na\n', 'a\n')).toEqual([3]);
    expect(windowMatches('ab\n', 'a')).toEqual([]);
    expect(windowMatches('b\na', 'a')).toEqual([2]);
  });

  test('every standing of a repeated window is found, overlapping ones included', () => {
    expect(windowMatches('a\na\na\n', 'a\na\n')).toEqual([0, 2]);
  });
});

describe('what a file holds', () => {
  const bytes = (...parts: (string | number[])[]): Uint8Array =>
    Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...new TextEncoder().encode(part)] : part)));

  test('text comes back without its byte order mark, which is reported beside it', () => {
    expect(contentOf(bytes('héllo\n'))).toEqual({ kind: 'text', text: 'héllo\n', bom: false });
    expect(contentOf(bytes([0xef, 0xbb, 0xbf], 'a'))).toEqual({ kind: 'text', text: 'a', bom: true });
    expect(contentOf(new Uint8Array())).toEqual({ kind: 'text', text: '', bom: false });
  });

  test('a NUL anywhere in the supplied bytes makes the content binary', () => {
    expect(contentOf(bytes('ab', [0], 'cd')).kind).toBe('binary');
    expect(contentOf(bytes('a'.repeat(7999), [0])).kind).toBe('binary');
    expect(contentOf(bytes('a'.repeat(8000), [0])).kind).toBe('binary');
  });

  test('bytes that are not UTF-8 are undecodable, not binary', () => {
    expect(contentOf(bytes('caf', [0xe9]))).toEqual({ kind: 'undecodable' });
  });
});

describe('text a decoder already produced', () => {
  test('a NUL anywhere makes decoded text binary, and withBom puts the byte order mark back', () => {
    expect(looksBinaryText('plain\n')).toBe(false);
    expect(looksBinaryText('a\0b')).toBe(true);
    expect(looksBinaryText(`${'a'.repeat(8000)}\0`)).toBe(true);
    expect(withBom({ kind: 'text', text: 'a', bom: true })).toBe('\uFEFFa');
  });
});
