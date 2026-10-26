import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { GateRefusal, refusalSchema } from './refusal.js';

it.effect('a gate refusal encodes directly into the wire contract', () =>
  Effect.gen(function* () {
    for (const inputFile of [undefined, '/draft.json']) {
      const refusal = new GateRefusal('field-invalid', 'the input cannot be applied', ['correct the input'], inputFile);
      const encoded = yield* Schema.encodeEffect(refusalSchema)(refusal);
      expect(encoded).toEqual({
        code: 'field-invalid',
        reason: 'the input cannot be applied',
        unblock: ['correct the input'],
        inputFile,
      });
    }
  }),
);
