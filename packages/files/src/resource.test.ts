import { describe, expect, it } from 'bun:test';
import * as Schema from 'effect/Schema';
import { LocationRevision, ResourceAddress } from './resource';

describe('filesystem resource records', () => {
  it('retains namespace distinctions and provider-native paths through JSON', () => {
    const codec = Schema.fromJsonString(Schema.Array(ResourceAddress));
    const input = [
      { namespaceId: 'host-storage', path: '/work/shared' },
      { namespaceId: 'guest-storage', path: '/work/shared' },
      { namespaceId: 'host-storage', path: '/work/e\u0301/../Case\n ' },
      { namespaceId: 'windows-storage', path: '\\\\server\\share\\Mixed Case\\file' },
    ];
    const value = Schema.decodeUnknownSync(codec)(JSON.stringify(input));
    expect(JSON.parse(Schema.encodeSync(codec)(value))).toEqual(input);
  });

  it('refuses addresses without a namespace or a path', () => {
    const decode = Schema.decodeUnknownSync(ResourceAddress);
    for (const input of [
      { path: '/work' },
      { namespaceId: '', path: '/work' },
      { namespaceId: 'host-storage', path: '' },
      { namespaceId: 'host-storage', path: 7 },
    ]) {
      expect(() => decode(input)).toThrow();
    }
  });

  it('retains exact nonnegative location revisions and refuses inexact counters', () => {
    const codec = Schema.fromJsonString(LocationRevision);
    for (const input of [0, 1, Number.MAX_SAFE_INTEGER]) {
      const value = Schema.decodeUnknownSync(codec)(JSON.stringify(input));
      expect(input).toBe(value);
      expect(JSON.parse(Schema.encodeSync(codec)(value))).toBe(input);
    }
    const decode = Schema.decodeUnknownSync(LocationRevision);
    for (const input of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1']) {
      expect(() => decode(input)).toThrow();
    }
  });
});
