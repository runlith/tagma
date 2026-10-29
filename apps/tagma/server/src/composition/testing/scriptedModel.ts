import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { Effect, Stream } from 'effect';
import type { ModelAccess } from '../../providers/contract/service/access.js';

export const scriptedModel =
  (chunks: Stream.Stream<string, LLMError> = Stream.succeed('Done.')) =>
  (standing: ModelAccess['Service']): ModelAccess['Service'] => ({
    ...standing,
    request: (selection) => ({
      system: selection.instructions,
      origin: new ModelIdentity({
        provider: ProviderID.make(selection.provider),
        model: ModelID.make(selection.model ?? 'scripted'),
      }),
      plannedOutputTokens: 32,
      text: () => Effect.die(new Error('the scripted model answers streamed requests only')),
      object: () => Effect.die(new Error('the scripted model answers streamed requests only')),
      stream: () =>
        Stream.concat(
          Stream.concat(
            Stream.fromIterable<LLMEvent>([
              { type: 'step-start', index: 0 },
              { type: 'text-start', id: 'reply' },
            ]),
            Stream.map(chunks, (text): LLMEvent => ({ type: 'text-delta', id: 'reply', text })),
          ),
          Stream.fromIterable<LLMEvent>([
            { type: 'text-end', id: 'reply' },
            { type: 'step-finish', index: 0, reason: 'stop' },
            { type: 'finish', reason: 'stop' },
          ]),
        ),
    }),
  });
