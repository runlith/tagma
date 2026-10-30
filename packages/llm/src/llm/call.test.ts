import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { generateObject } from './call';
import { prepare, LlmClient } from './route/client';
import { Usage } from './schema/events';
import { Model } from './schema/options';
import * as AnthropicMessages from './protocols/anthropic-messages';

const model = Model.make({ id: 'claude-test', provider: 'anthropic', route: AnthropicMessages.route });

const answering = (input: unknown) =>
  generateObject({
    model,
    prompt: 'Is it done?',
    jsonSchema: { type: 'object', properties: { done: { type: 'boolean' } }, required: ['done'], additionalProperties: false },
  }).pipe(
    Effect.provideService(
      LlmClient,
      LlmClient.of({
        prepare: () => Effect.die('the answer reads a stream'),
        generate: () => Effect.die('the answer reads a stream'),
        stream: (request) =>
          Stream.unwrap(
            Effect.as(
              prepare(request),
              Stream.fromIterable([
                { type: 'tool-call', id: 'call-1', name: 'generate_object', input },
                { type: 'finish', reason: 'tool-calls', usage: new Usage({ inputTokens: 20, outputTokens: 4 }) },
              ] as const),
            ),
          ),
      }),
    ),
  );

it.effect('an object asked by a JSON schema is refused as invalid output when the answer does not match it', () =>
  Effect.gen(function* () {
    expect((yield* answering({ done: true })).object).toEqual({ done: true });
    for (const off of [{}, { done: 'yes' }])
      expect(yield* answering(off).pipe(Effect.flip)).toMatchObject({ reason: { _tag: 'InvalidProviderOutput' } });
  }),
);
