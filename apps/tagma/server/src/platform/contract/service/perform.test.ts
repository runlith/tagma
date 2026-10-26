import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { arms } from '../wire/operation.js';
import { performOver } from './perform.js';

const readValue = { id: 'read_value', input: Schema.Struct({}), answer: arms({ ok: { value: Schema.Number } }) };

const answering = (answered: unknown) => performOver(() => Effect.succeed(answered))(readValue, {}, {});

it.effect('a typed reader takes an answer in its declared arms and refuses one outside them, a receipt among them', () =>
  Effect.gen(function* () {
    expect(yield* answering({ status: 'ok', value: 1 })).toEqual({ status: 'ok', value: 1 });
    const refused = yield* Effect.flip(answering({ status: 'running', runId: 'r', toolCallId: 'c' }));
    expect(Schema.isSchemaError(refused)).toBe(true);
  }),
);
