import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { toJsonSchema, ToolResultValue, toolInputSchema } from './messages';

describe('what a provider is told about a tool input', () => {
  test('a shape that admits an object among other things is that object', () => {
    expect(toJsonSchema(Schema.Struct({}))).toEqual({ not: { type: 'null' } });
    expect(toolInputSchema(Schema.Struct({}))).toEqual({ type: 'object' });
  });

  test('an ordinary struct passes through as it was written', () => {
    const struct = Schema.Struct({ name: Schema.String, count: Schema.optional(Schema.Number) });
    expect(toolInputSchema(struct)).toEqual(toJsonSchema(struct));
  });

  test('a union of object shapes keeps every canonical member under one object root', () => {
    const union = Schema.Union([
      Schema.Struct({ kind: Schema.tag('spec'), title: Schema.String }),
      Schema.Struct({ kind: Schema.tag('view'), query: Schema.String }),
    ]);
    expect(toolInputSchema(union)).toEqual({
      type: 'object',
      anyOf: expect.arrayContaining([
        expect.objectContaining({
          type: 'object',
          required: ['kind', 'title'],
        }),
        expect.objectContaining({
          type: 'object',
          required: ['kind', 'query'],
        }),
      ]),
    });
  });

  test('catalogs sharing one codec compile its tool schema once', () => {
    const parameters = Schema.Struct({ value: Schema.String });
    const firstCatalog = toolInputSchema(parameters);

    expect(toolInputSchema(parameters)).toBe(firstCatalog);
    expect(toolInputSchema(Schema.Struct({ value: Schema.Number }))).not.toBe(firstCatalog);
  });

  test('a shape that is no object at all is refused', () => {
    expect(() => toolInputSchema(Schema.String)).toThrow(/one object at the root/);
  });
});

describe('what a tool result value may be', () => {
  const encode = Schema.encodeUnknownResult(Schema.toCodecJson(ToolResultValue));

  test('encodes a value holding an undefined deep inside it', () => {
    const encoded = encode({ type: 'json', value: { ok: true, usage: { inputTokens: 5, reasoningTokens: undefined } } });
    expect(encoded._tag).toBe('Success');
    expect(encoded._tag === 'Success' ? encoded.success : null).toEqual({
      type: 'json',
      value: { ok: true, usage: { inputTokens: 5 } },
    });
  });

  test('encodes an array whose slot JSON cannot carry, keeping its length', () => {
    const encoded = encode({ type: 'json', value: [1, undefined, 3] });
    expect(encoded._tag === 'Success' ? encoded.success : null).toEqual({ type: 'json', value: [1, null, 3] });
  });

  test('decoding a tool result preserves its opaque value while checking the result envelope', () => {
    const value = { present: 1, absent: undefined };
    const decode = Schema.decodeUnknownSync(ToolResultValue);
    const result = decode({ type: 'json', value });
    expect(result.value).toBe(value);
    expect(() => decode({ type: 'unknown', value })).toThrow();
  });

  test('carries what a tool actually answered', () => {
    const encoded = encode({ type: 'json', value: { status: 'ok', count: 2 } });
    expect(encoded._tag === 'Success' ? encoded.success : null).toEqual({
      type: 'json',
      value: { status: 'ok', count: 2 },
    });
  });

  test('turns an answer of nothing into the absence JSON does have', () => {
    expect(ToolResultValue.from(undefined)).toEqual({ type: 'json', value: null });
  });

  test('keeps the kind a shaped answer names and carries its value', () => {
    expect(ToolResultValue.from({ type: 'error', value: 'it broke' })).toEqual({ type: 'error', value: 'it broke' });
    expect(ToolResultValue.from({ ok: true, missing: undefined }, 'json')).toEqual({
      type: 'json',
      value: { ok: true },
    });
  });
});
