import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Message } from '@runlith/llm/schema/messages';
import { Effect } from 'effect';
import { agentRuntimeGuidanceMessage, withAgentReaderInput } from '../../agent/AgentSignal';
import { makeThreadDigestStrategy } from './digestStrategy';
import type { ThreadCompactionPolicy } from './policy';
import { selectThreadCompactionPrefix } from './prefix';
const NOTE = 'NOTE-NEVER-RETOLD';
const exchange = (id: string, said: string, answer: string) => [
  withAgentReaderInput(Message.user(said), id),
  agentRuntimeGuidanceMessage(NOTE, { notes: { inputs: [id] } }, false),
  Message.assistant(answer),
];
const history = [...exchange('w-1', 'Fix the parser.', 'Parser fixed.'), ...exchange('w-2', 'Now the lexer.', 'Lexer fixed.')];
const policy = {
  maxRecentTokens: 100_000,
  minRecentTokens: 0,
  recentFraction: 1,
  recentUserTurns: 2,
} as ThreadCompactionPolicy;
it('the recent window counts the two operator exchanges, not each message and the note that follows it', () => {
  expect(selectThreadCompactionPrefix(history, 0, 100_000, policy)).toBeNull();
});
it.effect(
  'a summary never retells a note marked unretold',
  Effect.fnUntraced(function* () {
    const summary = yield* makeThreadDigestStrategy().summarize({
      threadId: 't',
      ownerId: 'o',
      provider: 'p',
      model: null,
      reasoning: null,
      switches: {},
      messages: history,
      alreadyCovered: 0,
      coveredMessageCount: history.length,
      priorSummary: null,
      usableTokens: () => 100_000,
      summaryBudgetTokens: 10_000,
    });
    expect(summary.summary).toContain('Fix the parser.');
    expect(summary.summary).not.toContain(NOTE);
  }),
);
