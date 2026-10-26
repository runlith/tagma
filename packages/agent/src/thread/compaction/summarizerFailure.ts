import { Data } from 'effect';
import { isContextOverflowFailure } from '@runlith/llm/provider-error';
import { LLMError } from '@runlith/llm/schema/errors';
import type { ThreadSummarizerSkipReason } from '../../transcript/entries';
import { ThreadSummaryFailedError } from '../storage/compaction';

export class ThreadSummarizerWindowError extends Data.TaggedError('ThreadSummarizerWindow')<{ readonly message: string }> {
  constructor(provider: string, model: string) {
    super({ message: `${provider}/${model} cannot hold even one message of the covered history beside its request.` });
    this.name = 'ThreadSummarizerWindowError';
  }
}

export function fallThrough(raised: unknown): ThreadSummarizerSkipReason | null {
  const failure = raised instanceof ThreadSummaryFailedError ? raised.failure : raised;
  if (failure instanceof ThreadSummarizerWindowError || isContextOverflowFailure(failure)) return 'overflow';
  if (!(failure instanceof LLMError)) return null;
  switch (failure.family) {
    case 'quota':
      return 'quota';
    case 'rate-limit':
      return 'rate-limited';
    case 'invalid-request':
    case 'content-policy':
    case 'invalid-output':
    case 'non-json-answer':
      return null;
    default:
      return 'unavailable';
  }
}
