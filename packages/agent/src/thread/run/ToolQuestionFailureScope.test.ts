import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { Tool } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { AgentRuleFailed } from '../../agent/AgentFailure';
import { AgentRuntimePolicy, agentRule } from '../../agent/policy/AgentRuntimePolicy';
import { ASKS_IN_REVIEW } from '../../permissions/vocabulary';
import { questionDoor } from '../conformance/questionDoor';
import { readApprovedCalls, toolQuestionFromCalls, toolResultsFromQuestion } from './ToolQuestion';
describe('ToolQuestion failure scope', () => {
  it.effect(
    'a rule failure in approved ends the resumed answer',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog = confirmableCatalog(items);
      const question = yield* toolQuestionFromCalls(open(), catalog, [call], askedAt);
      if (!question) return yield* Effect.die('Expected a confirmation');
      const failure = yield* Effect.flip(readApprovedCalls(open({ policy: breakingPolicy() }), catalog, question, confirm, inputs));
      expect(failure).toBeInstanceOf(AgentRuleFailed);
      if (!(failure instanceof AgentRuleFailed)) return yield* Effect.die('Expected the rule failure');
      expect(failure.ruleId).toBe('breaking-rule');
      expect(items.has('item-1')).toBe(true);
    }),
  );
  it.effect(
    'a rule failure in settlement ends the answer instead of becoming a call error',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog = confirmableCatalog(items);
      const question = yield* toolQuestionFromCalls(open(), catalog, [call], askedAt);
      if (!question) return yield* Effect.die('Expected a confirmation');
      const failure = yield* Effect.flip(
        toolResultsFromQuestion(open({ policy: breakingPolicy() }), catalog, question, confirm, inputs, { messages: [] }),
      );
      expect(failure).toBeInstanceOf(AgentRuleFailed);
      if (!(failure instanceof AgentRuleFailed)) return yield* Effect.die('Expected the rule failure');
      expect(failure.ruleId).toBe('breaking-rule');
      expect(items.has('item-1')).toBe(true);
    }),
  );
  it.effect(
    'call sets whose joined spellings collide address different questions',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const catalog = confirmableCatalog(new Set());
      const keyOf = Effect.fnUntraced(function* (runId: string, toolCallIds: readonly string[]) {
        const question = yield* toolQuestionFromCalls(
          open(),
          catalog,
          toolCallIds.map((toolCallId) => ({ ...call, runId, toolCallId })),
          askedAt,
        );
        if (!question) return yield* Effect.die('Expected grouped confirmations');
        return question.questionId;
      });
      const one = yield* keyOf('r', ['a:b', 'c']);
      const other = yield* keyOf('r', ['a', 'b:c']);
      expect(one).not.toBe(other);
      expect(yield* keyOf('run-1', ['tool-1', 'tool-2'])).toBe('tool-confirm:run-1:tool-1:tool-2');
    }),
  );
});
const askedAt = new Date(0).toISOString();
const call = { runId: 'run-1', toolCallId: 'tool-1', toolName: 'delete_item', input: { id: 'item-1' } };
const confirm = [{ questionId: 'tool-1', values: ['confirm'] }];
const inputs = new Map([['tool-1', { id: 'item-1' }]]);
function confirmableCatalog(items: Set<string>): ToolCatalog {
  return {
    delete_item: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_IN_REVIEW,
      description: 'Delete an item.',
      parameters: Schema.Struct({ id: Schema.String }),
      execute: (input) =>
        Effect.sync(() => {
          items.delete(input.id);
          return { deleted: input.id };
        }),
      mutates: true,
      confirmation: { prompt: () => ({ summary: 'Delete it?' }), confirmLabel: 'Delete' },
    }),
  };
}
function breakingPolicy() {
  return new AgentRuntimePolicy([
    agentRule('breaking-rule', () => Effect.fail(new Error('rule blew up')), { owner: 'test', critical: true }),
  ]);
}
