import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { inputDecoder } from './input.js';

const schema = Schema.Struct({
  inspection: Schema.Union([
    Schema.Struct({ builtin: Schema.Literal('modules'), params: Schema.Struct({ base: Schema.String }) }),
    Schema.Struct({
      bindings: Schema.Array(Schema.Struct({ runner: Schema.String, params: Schema.Record(Schema.String, Schema.Unknown) })),
    }),
  ]),
});
const decode = inputDecoder(schema);
const constrained = inputDecoder(
  Schema.Struct({
    inspection: Schema.Union([
      Schema.Struct({
        builtin: Schema.Literal('modules'),
        params: Schema.Struct({
          base: Schema.String,
          built: Schema.Array(Schema.Struct({ output: Schema.String.check(Schema.isPattern(/^[^/]+\.ts$/u)) })),
        }),
      }),
      Schema.Struct({ bindings: Schema.Array(Schema.String) }),
    ]),
  }),
);

it.effect('optional JSON null decodes as omission while a nullable patch preserves its null', () =>
  Effect.gen(function* () {
    const optional = inputDecoder(Schema.Struct({ limit: Schema.optional(Schema.Number), cursor: Schema.optional(Schema.String) }));
    expect(yield* optional({ limit: null, cursor: null })).toEqual(yield* optional({}));
    const patch = inputDecoder(Schema.Struct({ value: Schema.optionalKey(Schema.NullOr(Schema.String)) }));
    expect(yield* patch({ value: null })).toEqual({ value: null });
    expect(yield* patch({})).toEqual({});
  }),
);

it.effect('a union input preserves missing and constrained parameter failures instead of blaming a declared discriminant', () =>
  Effect.gen(function* () {
    const missing = yield* Effect.result(constrained({ inspection: { builtin: 'modules', params: {} } }));
    expect(missing).toMatchObject({ _tag: 'Failure', failure: { code: 'body-shape' } });
    if (missing._tag === 'Failure') {
      expect(missing.failure.reason).toContain('["inspection"]["params"]["base"]');
      expect(missing.failure.reason).toContain('["inspection"]["params"]["built"]');
    }
    const invalid = yield* Effect.result(
      constrained({ inspection: { builtin: 'modules', params: { base: '', built: [{ output: 'dist/' }] } } }),
    );
    expect(invalid).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'body-shape', reason: expect.stringContaining('["inspection"]["params"]["built"][0]["output"]') },
    });
  }),
);

it.effect('a refused field names what the call sent there, so a document sent as its JSON text reads as a string', () =>
  Effect.gen(function* () {
    const sent = yield* Effect.result(decode({ inspection: '{"builtin":"modules","params":{"base":""}}' }));
    expect(sent).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'body-shape', reason: expect.stringContaining('got "{\\"builtin\\":\\"modules\\"') },
    });
    const long = yield* Effect.result(decode({ inspection: 'x'.repeat(5000) }));
    expect(long._tag === 'Failure' && long.failure.reason.length < 1000).toBe(true);
  }),
);

it.effect('operation input refuses unknown nested fields while preserving declared open documents', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.result(decode({ inspection: { builtin: 'modules', params: { base: '', framework: ['$app/*'] } } }));
    expect(failure).toMatchObject({
      _tag: 'Failure',
      failure: {
        code: 'body-shape',
        reason: expect.stringContaining('["inspection"]["params"]["framework"]'),
      },
    });
    const open = { inspection: { bindings: [{ runner: 'custom', params: { free: { nested: true } } }] } };
    expect(yield* decode(open)).toEqual(open);
    const indexed = yield* Effect.result(decode({ inspection: { bindings: [{ runner: 'custom', params: {}, unknown: true }] } }));
    expect(indexed).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'body-shape', reason: expect.stringContaining('["inspection"]["bindings"][0]["unknown"]') },
    });
  }),
);
