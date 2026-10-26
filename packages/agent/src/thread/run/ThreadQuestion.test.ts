import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { RunStop } from '../../agent/RunStop';
import { Tool } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { AgentStep } from '../../agent/AgentStep';
import { AgentRuleFailed } from '../../agent/AgentFailure';
import { AgentRuntimePolicy, agentRule } from '../../agent/policy/AgentRuntimePolicy';
import { ASKS_IN_REVIEW } from '../../permissions/vocabulary';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import { ThreadCallBroke, threadCauseOf } from '../ThreadBorder';
import { questionDoor } from '../conformance/questionDoor';
import { runRow } from '../conformance/runCycle/runDoubles';
import {
  cancelledQuestion,
  pendingQuestionFromSteps,
  questionFromToolCalls,
  questionToolResultEvents,
  questionToolResults,
  toolMessageFromResults,
} from './ThreadQuestion';
import { toolResultsFromQuestion } from './ToolQuestion';
describe('ThreadQuestion', () => {
  it.effect(
    'keeps every parallel ask_user call and returns one result per tool call',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const question = yield* questionFromToolCalls(watchedRun(), open(), {}, [askCall('ask-1'), askCall('ask-2')]);
      if (!question) return yield* Effect.die('Expected an interactive question');
      expect(question.toolCalls).toEqual([
        { toolCallId: 'ask-1', toolName: 'ask_user' },
        { toolCallId: 'ask-2', toolName: 'ask_user' },
      ]);
      expect(question.questions.map((prompt) => prompt.toolCallId)).toEqual(['ask-1', 'ask-2']);
      const { results } = yield* questionToolResults({
        door: open(),
        question,
        answers: [
          { questionId: 'ask-1', values: ['beginner'] },
          { questionId: 'ask-2', values: ['reader'] },
        ],
        transcript: [],
        options: { messages: [] },
        halt: new RunStop(),
        catalog: {},
      });
      expect(results).toMatchObject([
        {
          toolCallId: 'ask-1',
          toolName: 'ask_user',
          outcome: { kind: 'answered', output: { status: 'answered', answers: [{ values: ['beginner'] }] } },
        },
        {
          toolCallId: 'ask-2',
          toolName: 'ask_user',
          outcome: { kind: 'answered', output: { status: 'answered', answers: [{ values: ['reader'] }] } },
        },
      ]);
    }),
  );
  test('persists explicit denied and failed states for answered gated tools', () => {
    const transcript = [
      {
        type: 'tool',
        id: 'tool:cancelled',
        toolName: 'delete_item',
        toolCallId: 'cancelled',
        toolState: 'input-available',
        toolInput: { id: 'item-1' },
      },
      {
        type: 'tool',
        id: 'tool:failed',
        toolName: 'delete_item',
        toolCallId: 'failed',
        toolState: 'input-available',
        toolInput: { id: 'item-2' },
      },
    ];
    const events = questionToolResultEvents(transcript, questionOver('run-1'), [
      {
        toolCallId: 'cancelled',
        toolName: 'delete_item',
        outcome: { kind: 'denied', output: { status: 'cancelled' } },
        modelOutput: { type: 'json', value: { status: 'cancelled' } },
      },
      {
        toolCallId: 'failed',
        toolName: 'delete_item',
        outcome: { kind: 'failed', error: 'delete failed', output: { status: 'failed' } },
        modelOutput: { type: 'error', value: 'delete failed' },
      },
    ]);
    expect(events.map((event) => event.payload.entry)).toMatchObject([
      { id: 'tool:cancelled', toolCallId: 'cancelled', toolState: 'output-denied' },
      { id: 'tool:failed', toolCallId: 'failed', toolState: 'output-error', toolError: 'delete failed' },
    ]);
  });
  it.effect(
    'a run nobody can answer builds no question',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      expect(yield* questionFromToolCalls(watchedRun(false), open(), {}, [askCall('ask-1')])).toBeNull();
    }),
  );
  it.effect(
    'clears every unresolved tool call when its run terminates',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const question = yield* questionFromToolCalls(watchedRun(), open(), {}, [askCall('ask-1')]);
      if (!question) return yield* Effect.die('Expected an interactive question');
      const transcript = [
        { type: 'tool', id: 'tool:ask-1', toolName: 'ask_user', toolCallId: 'ask-1', toolState: 'input-available' },
        question,
      ];
      const cancelled = cancelledQuestion(question, 'Run failed.');
      expect(cancelled.question.status).toBe('cleared');
      expect(questionToolResultEvents(transcript, cancelled.question, cancelled.results).map((event) => event.payload.entry)).toMatchObject(
        [{ toolCallId: 'ask-1', toolState: 'output-cancelled' }],
      );
      expect(cancelled.message).toMatchObject({
        role: 'tool',
        content: [{ id: 'ask-1', result: { type: 'json', value: { status: 'cancelled' } } }],
      });
    }),
  );
  it.effect(
    'resolves a mixed ask_user and gated tool interaction completely',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog = deleting(items);
      const question = yield* questionFromToolCalls(watchedRun(), open(), catalog, [askCall('ask-1'), deleteCall]);
      if (!question) return yield* Effect.die('Expected a mixed question');
      expect(question.toolCalls).toEqual([
        { toolCallId: 'ask-1', toolName: 'ask_user' },
        { toolCallId: 'delete-1', toolName: 'delete_item' },
      ]);
      expect(items.has('item-1')).toBe(true);
      const { results } = yield* questionToolResults({
        door: open(),
        question,
        answers: [
          { questionId: 'ask-1', values: ['item-2'] },
          { questionId: 'delete-1', values: ['confirm'] },
        ],
        transcript: [deleteEntry],
        options: { messages: [] },
        halt: new RunStop(),
        catalog,
      });
      expect(results).toMatchObject([
        { toolCallId: 'ask-1', toolName: 'ask_user', outcome: { kind: 'answered', output: { status: 'answered' } } },
        { toolCallId: 'delete-1', toolName: 'delete_item', outcome: { kind: 'answered', output: { deleted: 'item-1' } } },
      ]);
      expect(items.has('item-1')).toBe(false);
    }),
  );
  it.effect(
    'carries the door projection into the tool message',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const catalog = deleting(new Set(['item-1']));
      const question = yield* questionFromToolCalls(watchedRun(), open(), catalog, [deleteCall]);
      if (!question) return yield* Effect.die('Expected a confirmation');
      const { results } = yield* questionToolResults({
        door: open({
          outputs: {
            project: () =>
              Effect.succeed({
                output: { truncated: true, outputId: 'output-stable', preview: 'bounded output' },
                modelOutput: { type: 'text', value: 'bounded output' },
              }),
            projectMessages: () => Effect.die('Question settlement must carry the projected result'),
          },
        }),
        question,
        answers: [{ questionId: 'delete-1', values: ['confirm'] }],
        transcript: [deleteEntry],
        options: { messages: [] },
        halt: new RunStop(),
        catalog,
      });
      expect(results).toMatchObject([
        { outcome: { output: { outputId: 'output-stable' } }, modelOutput: { type: 'text', value: 'bounded output' } },
      ]);
      expect(toolMessageFromResults(results)).toMatchObject({
        content: [{ id: 'delete-1', result: { type: 'text', value: 'bounded output' } }],
      });
    }),
  );
  it.effect(
    'a partial user answer refuses before a gated call can execute',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog = deleting(items);
      const question = yield* questionFromToolCalls(watchedRun(), open(), catalog, [askCall('ask-1'), askCall('ask-2'), deleteCall]);
      if (!question) return yield* Effect.die('Expected an interactive question');
      const failure = yield* Effect.flip(
        questionToolResults({
          door: open(),
          question,
          answers: [
            { questionId: 'ask-1', values: ['beginner'] },
            { questionId: 'delete-1', values: ['confirm'] },
          ],
          transcript: [deleteEntry],
          options: { messages: [] },
          halt: new RunStop(),
          catalog,
        }),
      );
      expect(failure).toBeInstanceOf(ThreadCallBroke);
      expect(items.has('item-1')).toBe(true);
    }),
  );
  it.effect(
    'a mixed set containing an uncarriable call fails typed',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const failure = yield* Effect.flip(
        questionFromToolCalls(watchedRun(), open(), deleting(new Set()), [
          deleteCall,
          { runId: 'run-1', toolCallId: 'bogus-1', toolName: 'bogus_tool', input: {} },
        ]),
      );
      expect(failure).toBeInstanceOf(ThreadCallBroke);
    }),
  );
  it.effect(
    'calls no question can carry park nothing on their own',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      expect(
        yield* questionFromToolCalls(watchedRun(), open(), {}, [
          { runId: 'run-1', toolCallId: 'bogus-1', toolName: 'bogus_tool', input: {} },
        ]),
      ).toBeNull();
    }),
  );
  it.effect(
    'a completed run holding a call nobody can answer fails typed',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const run = watchedRun(false);
      const failure = yield* Effect.flip(
        pendingQuestionFromSteps(run, [stepCalling('start_terminal')], (calls) => questionFromToolCalls(run, open(), {}, calls)),
      );
      expect(failure).toBeInstanceOf(ThreadCallBroke);
    }),
  );
  it.effect(
    'a late question starts its deadline when asked, not when the run started',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const staged = new Set<string>();
      const catalog: ToolCatalog = {
        stage_all: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_IN_REVIEW,
          description: 'Stage changes.',
          parameters: Schema.Struct({}),
          execute: () =>
            Effect.sync(() => {
              staged.add('changes');
              return { staged: true };
            }),
          prepare: () => Effect.succeed({ subjects: [{ kind: 'execute' as const, value: 'git add -A' }] }),
        }),
      };
      const run = watchedRun();
      const asking = open();
      yield* TestClock.adjust('5 minutes');
      const question = yield* pendingQuestionFromSteps(run, [stepCalling('stage_all')], (calls) =>
        questionFromToolCalls(run, asking, catalog, calls),
      );
      if (!question) return yield* Effect.die('Expected a question');
      expect(question.occurredAt).toBe(new Date(300_000).toISOString());
      yield* TestClock.adjust('30 seconds');
      const results = yield* toolResultsFromQuestion(
        open({ resolutions: asking.resolutionsOf(['call-1']) }),
        catalog,
        question,
        [{ questionId: 'call-1', values: ['confirm'] }],
        new Map([['call-1', {}]]),
        { messages: [] },
      );
      expect(results[0]?.outcome.kind).toBe('answered');
      expect(staged.has('changes')).toBe(true);
    }),
  );
  it.effect(
    'a run whose every call settled is awaiting nothing',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const run = watchedRun(false);
      const settled = { ...stepCalling('read_block'), toolResults: [{ toolCallId: 'call-1', toolName: 'read_block', output: {} }] };
      expect(yield* pendingQuestionFromSteps(run, [settled], (calls) => questionFromToolCalls(run, open(), {}, calls))).toBeNull();
    }),
  );
  it.effect(
    'a rule failure while settling an answer fails the answer instead of minting a result',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog = deleting(items);
      const question = yield* questionFromToolCalls(watchedRun(), open(), catalog, [deleteCall]);
      if (!question) return yield* Effect.die('Expected a confirmation');
      const failure = yield* Effect.flip(
        questionToolResults({
          door: open({
            policy: new AgentRuntimePolicy([
              agentRule('breaking-rule', () => Effect.fail(new Error('rule blew up')), { owner: 'test', critical: true }),
            ]),
          }),
          question,
          answers: [{ questionId: 'delete-1', values: ['confirm'] }],
          transcript: [deleteEntry],
          options: { messages: [] },
          halt: new RunStop(),
          catalog,
        }),
      );
      expect(failure).toBeInstanceOf(ThreadCallBroke);
      const cause = threadCauseOf(failure);
      expect(cause).toBeInstanceOf(AgentRuleFailed);
      if (!(cause instanceof AgentRuleFailed)) return yield* Effect.die('Expected the rule failure');
      expect(cause.ruleId).toBe('breaking-rule');
      expect(items.has('item-1')).toBe(true);
    }),
  );
});
const deleteCall = { runId: 'run-1', toolCallId: 'delete-1', toolName: 'delete_item', input: { id: 'item-1' } };
const deleteEntry = {
  type: 'tool',
  id: 'tool:delete-1',
  runId: 'run-1',
  toolName: 'delete_item',
  toolCallId: 'delete-1',
  toolState: 'input-available',
  toolInput: { id: 'item-1' },
};
function deleting(items: Set<string>): ToolCatalog {
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
function questionOver(runId: string): ThreadQuestionEntry {
  return {
    type: 'question',
    id: `transcript:question:${runId}`,
    runId,
    questionId: 'question-1',
    questions: [],
    toolCalls: [],
    status: 'answered',
  };
}
function askCall(toolCallId: string) {
  return { runId: 'run-1', toolCallId, toolName: 'ask_user', input: { questions: [{ prompt: 'Choose a value.', allowFreeform: true }] } };
}
function watchedRun(interactive = true) {
  return runRow('run-1', { interactive });
}
function stepCalling(toolName: string): AgentStep {
  return {
    content: [],
    text: '',
    reasoningText: undefined,
    toolCalls: [{ toolCallId: 'call-1', toolName, input: {} }],
    toolResults: [],
    usage: undefined,
  };
}
