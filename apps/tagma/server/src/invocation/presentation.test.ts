import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import type { OperationId } from '../platform/contract/wire/ids.js';
import { VoiceUnrendered, type Presentation } from '../platform/contract/service/presentation.js';
import { voiced } from './presentation.js';

const spokenBy = (voice: Presentation['voice']) =>
  voiced(
    { voice, called: null, settled: () => undefined, negative: null },
    Schema.Unknown,
    'create_block' as OperationId,
    { name: 'b1' },
    {},
    { actor: { kind: 'operator' }, files: null },
  );

it.effect('a voice that fails or throws still answers that the act happened, with its document', () =>
  Effect.gen(function* () {
    const failing = yield* spokenBy(() => Effect.fail(new VoiceUnrendered({ message: 'vocabulary unreadable' })));
    const throwing = yield* spokenBy(() =>
      Effect.sync(() => {
        throw new Error('printer broke');
      }),
    );
    for (const [text, reason] of [
      [failing, 'vocabulary unreadable'],
      [throwing, 'printer broke'],
    ] as const) {
      expect(text).toContain(reason);
      expect(text).toContain('{"name":"b1"}');
    }
  }),
);
