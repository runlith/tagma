import { describe, expect, it } from 'bun:test';
import * as Schema from 'effect/Schema';
import { IdentityWitness, NamespaceId } from './namespace';

describe('filesystem identity records', () => {
  it('round-trips namespace identifiers without interpreting their spelling', () => {
    const codec = Schema.fromJsonString(NamespaceId);
    const input = 'provider:storage/ A\\B ';
    const value = Schema.decodeUnknownSync(codec)(JSON.stringify(input));
    expect(input).toBe(value);
    expect(JSON.parse(Schema.encodeSync(codec)(value))).toBe(input);
    expect(() => Schema.decodeUnknownSync(codec)('""')).toThrow();
    expect(() => Schema.decodeUnknownSync(codec)('42')).toThrow();
  });

  it('preserves the issuing backend, witness format and opaque token through JSON', () => {
    const codec = Schema.fromJsonString(IdentityWitness);
    const input = { provider: 'fixture-fs', format: 'directory-v1', token: ' A\\B/\u00e9\n ' };
    const value = Schema.decodeUnknownSync(codec)(JSON.stringify(input));
    expect(value).toEqual(input);
    expect(JSON.parse(Schema.encodeSync(codec)(value))).toEqual(input);
  });

  it('refuses incomplete or malformed backend witness records', () => {
    const decode = Schema.decodeUnknownSync(IdentityWitness);
    for (const input of [
      { format: 'directory-v1', token: 'opaque' },
      { provider: 'fixture-fs', format: '', token: 'opaque' },
      { provider: 'fixture-fs', format: 'directory-v1', token: 7 },
      { provider: 'fixture-fs', format: 'directory-v1', token: '' },
    ]) {
      expect(() => decode(input)).toThrow();
    }
  });
});
