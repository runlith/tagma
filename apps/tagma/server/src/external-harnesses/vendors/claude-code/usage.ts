import { Schema } from 'effect';
import { Usage } from '@runlith/llm/schema/events';

const spend = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_read_input_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: Schema.optional(Schema.Number),
});

const isSpend = Schema.is(spend);

export const claudeUsage = (raw: unknown): Usage | null => {
  if (!isSpend(raw)) return null;
  const hasInput = [raw.input_tokens, raw.cache_read_input_tokens, raw.cache_creation_input_tokens].some((value) => value !== undefined);
  if (!hasInput && raw.output_tokens === undefined) return null;
  return new Usage({
    inputTokens: hasInput
      ? (raw.input_tokens ?? 0) + (raw.cache_read_input_tokens ?? 0) + (raw.cache_creation_input_tokens ?? 0)
      : undefined,
    nonCachedInputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheReadInputTokens: raw.cache_read_input_tokens,
    cacheWriteInputTokens: raw.cache_creation_input_tokens,
  });
};
