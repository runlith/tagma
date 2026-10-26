import { Exit, Schema } from 'effect';
import { Usage as SpentUsage } from '@runlith/acp/methods';
import { InvalidProviderOutputReason, LLMError, TransportReason } from '@runlith/llm/schema/errors';
import { failureText, spend } from '../projection.js';
import { handled, settledBy, type Answering, type AsideOutcome, type Settlement } from './declaration.js';

const settled = settledBy(Schema.Struct({ text: Schema.String, usage: Schema.optional(SpentUsage) }));

export const asideLost = (message: string) =>
  new LLMError({ module: 'harness', method: 'aside', reason: new TransportReason({ message }) });

const unreadable = (message: string) =>
  new LLMError({ module: 'harness', method: 'aside', reason: new InvalidProviderOutputReason({ message }) });

const outcomeOf = (event: Settlement): AsideOutcome => {
  const read = settled(event);
  if (read._tag === 'Failed') {
    return Exit.fail(
      event._tag === 'ExtensionAnswered'
        ? unreadable('The agent answered the aside with a body Tagma cannot read.')
        : asideLost(failureText(read.cause)),
    );
  }
  const usage = spend(read.answer.usage ?? null);
  return Exit.succeed({ text: read.answer.text, finishReason: 'stop', usage: usage ?? undefined });
};

export const aside: Answering = {
  refusal: null,
  answered: (row, request, event) => ({ ...handled(row), asides: [{ request: request.id, outcome: outcomeOf(event) }] }),
};
