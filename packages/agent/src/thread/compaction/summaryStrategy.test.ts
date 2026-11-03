import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { LLMError, QuotaExceededReason } from '@runlith/llm/schema/errors';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import type { FinishReason } from '@runlith/llm/schema/ids';
import { Message } from '@runlith/llm/schema/messages';
import { ThreadSummaryFailedError } from '../storage/compaction';
import type { CompactionModels } from './CompactionModels';
import { fallThrough } from './summarizerFailure';
import { makeThreadSummaryStrategy } from './summaryStrategy';
import type { ThreadCompactionSegment } from './strategy';
const prompt = { instructions: 'Summarize the thread segment.', template: 'Use exactly these sections:\n## State' };
const answered = (text: string, finishReason: FinishReason): LLMResponse =>
  new LLMResponse({
    message: Message.assistant(text),
    events: [{ type: 'text-delta', id: 'text-1', text }],
    usage: new Usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
    finishReason,
  });
const modelThat = (call: () => Effect.Effect<LLMResponse, LLMError>, account?: string): CompactionModels => ({
  request: () => ({
    plannedOutputTokens: 32_000,
    signedAccount: () => account,
    text: call,
    stream: () => Stream.empty,
    object: () => Effect.die('This summary uses text.'),
  }),
  served: () => Effect.die('This segment already holds its model capacity.'),
  defaultModel: () => null,
});
const segment: ThreadCompactionSegment = {
  threadId: 'thread-1',
  ownerId: 'owner-1',
  provider: 'openai-oauth',
  model: 'gpt-5.6-luna',
  reasoning: null,
  switches: {},
  messages: [Message.user('work'), Message.assistant('done')],
  alreadyCovered: 0,
  coveredMessageCount: 2,
  priorSummary: null,
  usableTokens: () => 100_000,
  summaryBudgetTokens: 3_000,
};
const failure = (call: () => Effect.Effect<LLMResponse, LLMError>, account?: string) =>
  Effect.flip(makeThreadSummaryStrategy({ models: modelThat(call, account), prompt }).summarize(segment));
describe('ThreadSummaryStrategy refusals', () => {
  it.effect.each([
    ['a summary the model cut short', () => Effect.succeed(answered('## State\n- partial', 'length')), 'unfinished'],
    ['an empty summary', () => Effect.succeed(answered('   ', 'stop')), 'empty'],
    ['a summary that keeps too little of the covered turns', () => Effect.succeed(answered('x', 'stop')), 'too-short'],
  ] as const)(
    '%s is a typed refusal that names its reason and falls through nowhere',
    Effect.fnUntraced(function* (_, call, reason) {
      const refused = yield* failure(call);
      expect(refused).toBeInstanceOf(ThreadSummaryFailedError);
      expect(refused.reason).toBe(reason);
      expect(fallThrough(refused)).toBeNull();
    }),
  );
  it.effect(
    'a model failure carries its original cause and the account it ran on, and a quota failure still falls through',
    Effect.fnUntraced(function* () {
      const quota = new LLMError({ module: 'LLM', method: 'text', reason: new QuotaExceededReason({ message: 'out of quota' }) });
      const refused = yield* failure(() => Effect.fail(quota), 'resolved-login');
      expect(refused.reason).toBe('model');
      expect(refused.failure).toBe(quota);
      expect(refused.account).toBe('resolved-login');
      expect(fallThrough(refused)).toBe('quota');
    }),
  );
});
