import { describe, expect, test } from 'bun:test';
import { canonicalJson } from './object.js';

describe('canonicalJson', () => {
  test('sorts object keys by UTF-16 code unit at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  test('keeps array order and serializes primitives as JSON', () => {
    expect(canonicalJson([{ b: 1, a: 2 }, 'x', 3, null, true])).toBe('[{"a":2,"b":1},"x",3,null,true]');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
  });

  test('writes what JSON writes: an unset member is absent and an unset array slot is null', () => {
    expect(canonicalJson({ b: undefined, a: { c: undefined, d: 1 } })).toBe(canonicalJson({ a: { d: 1 } }));
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    expect(canonicalJson(new Array(2))).toBe(JSON.stringify(new Array(2)));
  });

  test('is insensitive to source key insertion order', () => {
    const left = canonicalJson({ z: [1, 2], a: { y: 1, x: 2 } });
    const right = canonicalJson({ a: { x: 2, y: 1 }, z: [1, 2] });
    expect(left).toBe(right);
  });
});
