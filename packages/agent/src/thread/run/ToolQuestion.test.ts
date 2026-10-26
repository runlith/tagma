import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { RunStop } from '../../agent/RunStop';
import { Tool, ToolFailed } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import { ASKS_IN_REVIEW } from '../../permissions/vocabulary';
import { THREAD_TOOL_CONFIRM_KIND } from '../../transcript/parts';
import { questionDoor } from '../conformance/questionDoor';
import {
  readApprovedCalls,
  toolQuestionFromCall,
  toolQuestionFromCalls,
  toolResultsFromQuestion,
  type AskedToolCall,
} from './ToolQuestion';
describe('ToolQuestion', () => {
  it.effect(
    'declining a parked call closes its shared invocation without executing it',
    Effect.fnUntraced(function* () {
      const { open, calls } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog = deleting(items);
      const question = yield* questionFromCall(open(), catalog, deleteCall);
      if (!question) return yield* Effect.die('Expected an approval question');
      expect(calls.get(deleteCall)?.record.endedAt).toBeNull();
      const results = yield* toolResultsFromQuestion(
        open(),
        catalog,
        question,
        [{ questionId: 'tool-1', values: ['cancel'] }],
        deleteInputs,
        { messages: [] },
      );
      expect(items.has('item-1')).toBe(true);
      expect(results[0]?.outcome).toMatchObject({ kind: 'denied', output: { status: 'refused', code: 'declined' } });
      expect(calls.get(deleteCall)?.record).toMatchObject({ phase: 'stopped', endedAt: expect.any(Number) });
    }),
  );
  it.effect(
    'defers unsafe tool execution until user confirmation',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog = deleting(items);
      const question = yield* questionFromCall(open(), catalog, deleteCall);
      if (!question) return yield* Effect.die('Expected an approval question');
      expect(items.has('item-1')).toBe(true);
      expect(question).toMatchObject({
        toolCalls: [{ toolCallId: 'tool-1', toolName: 'delete_item' }],
        questions: [{ id: 'tool-1', kind: THREAD_TOOL_CONFIRM_KIND, options: [{ value: 'confirm' }, { value: 'cancel' }] }],
      });
      const results = yield* toolResultsFromQuestion(
        open(),
        catalog,
        question,
        [{ questionId: 'tool-1', values: ['confirm'] }],
        deleteInputs,
        { messages: [] },
      );
      expect(results[0]?.outcome).toEqual({ kind: 'answered', output: { deleted: 'item-1' } });
      expect(items.has('item-1')).toBe(false);
    }),
  );
  for (const [elapsed, outcome] of [
    ['2 minutes', 'answered'],
    ['121 seconds', 'denied'],
  ] as const) {
    it.effect(
      `a confirmation at ${elapsed} is ${outcome} under the declared deadline`,
      Effect.fnUntraced(function* () {
        const { open } = yield* questionDoor;
        const staged = new Set<string>();
        const catalog: ToolCatalog = {
          stage_all: Tool.make({
            display: () => ({ form: 'none' }),
            approval: { asksFrom: 'review', timeout: Duration.minutes(2) },
            description: 'Stage changes.',
            parameters: Schema.Struct({}),
            prepare: () => Effect.succeed({ subjects: [{ kind: 'execute' as const, value: 'git add -A' }] }),
            execute: () =>
              Effect.sync(() => {
                staged.add('changes');
                return { staged: true };
              }),
          }),
        };
        const parking = open();
        const call = { runId: 'run-1', toolCallId: 'sweep-1', toolName: 'stage_all', input: {} };
        const question = yield* questionFromCall(parking, catalog, call);
        if (!question) return yield* Effect.die('Expected a question with a deadline');
        yield* TestClock.adjust(elapsed);
        const results = yield* toolResultsFromQuestion(
          open({ resolutions: parking.resolutionsOf(['sweep-1']) }),
          catalog,
          question,
          [{ questionId: 'sweep-1', values: ['confirm'] }],
          new Map([['sweep-1', {}]]),
          { messages: [] },
        );
        expect(results[0]?.outcome.kind).toBe(outcome);
        expect(staged.has('changes')).toBe(outcome === 'answered');
      }),
    );
  }
  it.effect(
    'a stop mid-answer keeps what already ran and calls the cut mutation unsettled',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const halt = new RunStop();
      const notes = new Set<string>();
      const catalog: ToolCatalog = {
        note_thing: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_IN_REVIEW,
          description: 'Note a thing.',
          parameters: Schema.Struct({ of: Schema.String }),
          execute: (input) =>
            Effect.suspend(() => {
              if (input.of === 'first') {
                notes.add(input.of);
                return Effect.succeed({ noted: input.of });
              }
              halt.stop(new Error('Run stopped'));
              return Effect.never;
            }),
          mutates: true,
          confirmation: { prompt: () => ({ summary: 'Note it?' }), confirmLabel: 'Note' },
        }),
      };
      const door = open();
      const question = yield* toolQuestionFromCalls(
        door,
        catalog,
        [
          { runId: 'run-1', toolCallId: 'tool-1', toolName: 'note_thing', input: { of: 'first' } },
          { runId: 'run-1', toolCallId: 'tool-2', toolName: 'note_thing', input: { of: 'second' } },
        ],
        askedAt,
      );
      if (!question) return yield* Effect.die('Expected grouped confirmations');
      const results = yield* toolResultsFromQuestion(
        door,
        catalog,
        question,
        [
          { questionId: 'tool-1', values: ['confirm'] },
          { questionId: 'tool-2', values: ['confirm'] },
        ],
        new Map([
          ['tool-1', { of: 'first' }],
          ['tool-2', { of: 'second' }],
        ]),
        { messages: [] },
        halt,
      );
      expect([...notes]).toEqual(['first']);
      expect(results).toMatchObject([
        { toolCallId: 'tool-1', outcome: { kind: 'answered', output: { noted: 'first' } } },
        { toolCallId: 'tool-2', outcome: { kind: 'unknown' } },
      ]);
    }),
  );
  it.effect(
    'groups confirmed calls into matching tool and model results',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1', 'item-2']);
      const catalog = deleting(items);
      const question = yield* toolQuestionFromCalls(
        open(),
        catalog,
        [deleteCall, { ...deleteCall, toolCallId: 'tool-2', input: { id: 'item-2' } }],
        askedAt,
      );
      if (!question) return yield* Effect.die('Expected grouped confirmations');
      expect(question).toMatchObject({
        questionId: 'tool-confirm:run-1:tool-1:tool-2',
        questions: [
          { id: 'tool-1', kind: THREAD_TOOL_CONFIRM_KIND },
          { id: 'tool-2', kind: THREAD_TOOL_CONFIRM_KIND },
        ],
      });
      const results = yield* toolResultsFromQuestion(
        open(),
        catalog,
        question,
        [
          { questionId: 'tool-1', values: ['confirm'] },
          { questionId: 'tool-2', values: ['confirm'] },
        ],
        new Map([
          ['tool-1', { id: 'item-1' }],
          ['tool-2', { id: 'item-2' }],
        ]),
        { messages: [] },
      );
      expect(results).toMatchObject([
        {
          toolCallId: 'tool-1',
          toolName: 'delete_item',
          outcome: { kind: 'answered', output: { deleted: 'item-1' } },
          modelOutput: { type: 'json', value: { deleted: 'item-1' } },
        },
        {
          toolCallId: 'tool-2',
          toolName: 'delete_item',
          outcome: { kind: 'answered', output: { deleted: 'item-2' } },
          modelOutput: { type: 'json', value: { deleted: 'item-2' } },
        },
      ]);
      expect(items.size).toBe(0);
    }),
  );
  it.effect(
    'returns a failed tool outcome when confirmed execution fails',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const catalog: ToolCatalog = {
        delete_item: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_IN_REVIEW,
          description: 'Delete an item.',
          parameters: Schema.Struct({ id: Schema.String }),
          execute: () => Effect.fail(new ToolFailed({ reason: 'missing-target' })),
          mutates: true,
          confirmation: { prompt: () => ({ summary: 'Delete it?' }), confirmLabel: 'Delete' },
        }),
      };
      const question = yield* questionFromCall(open(), catalog, deleteCall);
      if (!question) return yield* Effect.die('Expected a confirmation');
      const results = yield* toolResultsFromQuestion(
        open(),
        catalog,
        question,
        [{ questionId: 'tool-1', values: ['confirm'] }],
        deleteInputs,
        { messages: [] },
      );
      expect(results).toMatchObject([
        {
          toolCallId: 'tool-1',
          toolName: 'delete_item',
          outcome: { kind: 'failed', error: 'missing-target', output: { status: 'failed', reason: 'missing-target' } },
          modelOutput: { type: 'error', value: 'missing-target' },
        },
      ]);
    }),
  );
  it.effect(
    'a coded refusal after confirmation settles as refused',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const catalog: ToolCatalog = {
        delete_item: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_IN_REVIEW,
          description: 'Delete an item.',
          parameters: Schema.Struct({ id: Schema.String }),
          refusals: { 'not-found': 'Not found' },
          execute: () => Effect.fail(new ToolFailed({ reason: 'no such item', code: 'not-found' })),
          mutates: true,
          confirmation: { prompt: () => ({ summary: 'Delete it?' }), confirmLabel: 'Delete' },
        }),
      };
      const question = yield* questionFromCall(open(), catalog, deleteCall);
      if (!question) return yield* Effect.die('Expected a confirmation');
      const results = yield* toolResultsFromQuestion(
        open(),
        catalog,
        question,
        [{ questionId: 'tool-1', values: ['confirm'] }],
        deleteInputs,
        { messages: [] },
      );
      expect(results).toMatchObject([
        { toolCallId: 'tool-1', outcome: { kind: 'refused', refusal: { code: 'not-found', reason: 'no such item' } } },
      ]);
    }),
  );
  it.effect(
    'a failed confirmation preview still parks the mutation for an answer',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const items = new Set(['item-1']);
      const catalog: ToolCatalog = {
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
          confirmation: {
            prompt: () => ({ summary: 'Delete it?' }),
            prepare: () => Effect.fail(new Error('preview-unavailable')),
            confirmLabel: 'Delete',
          },
        }),
      };
      const door = open();
      const question = yield* questionFromCall(door, catalog, deleteCall);
      if (!question) return yield* Effect.die('Expected the fallback confirmation');
      expect(question).toMatchObject({ status: 'open', questions: [{ id: 'tool-1', kind: THREAD_TOOL_CONFIRM_KIND }] });
      expect(items.has('item-1')).toBe(true);
      const results = yield* toolResultsFromQuestion(
        door,
        catalog,
        question,
        [{ questionId: 'tool-1', values: ['confirm'] }],
        deleteInputs,
        { messages: [] },
      );
      expect(results[0]?.outcome).toEqual({ kind: 'answered', output: { deleted: 'item-1' } });
      expect(items.has('item-1')).toBe(false);
    }),
  );
  it.effect(
    'keeps a long grouped address within the answer API limit without changing call addresses',
    Effect.fnUntraced(function* () {
      const { open } = yield* questionDoor;
      const ids = [`${'x'.repeat(260)}a`, `${'x'.repeat(260)}b`];
      const question = yield* toolQuestionFromCalls(
        open(),
        deleting(new Set()),
        ids.map((toolCallId) => ({ ...deleteCall, toolCallId })),
        askedAt,
      );
      if (!question) return yield* Effect.die('Expected grouped confirmations');
      expect(question.questionId.length).toBeLessThanOrEqual(512);
      expect(question.questions.map((prompt) => prompt.id)).toEqual(ids);
    }),
  );
  describe('prepared selection', () => {
    it.effect(
      'runs over the resolution shown to the reader',
      Effect.fnUntraced(function* () {
        const { open } = yield* questionDoor;
        const selection = selecting();
        const door = open();
        const question = yield* selection.ask(door);
        const results = yield* toolResultsFromQuestion(door, selection.catalog, question, confirm, inputs, { messages: [] });
        expect(results[0]?.outcome).toEqual({ kind: 'answered', output: { read: ['thread-a'] } });
      }),
    );
    it.effect(
      'refuses a lost resolution without reading unjudged members',
      Effect.fnUntraced(function* () {
        const { open } = yield* questionDoor;
        const selection = selecting();
        const question = yield* selection.ask(open());
        const results = yield* toolResultsFromQuestion(open(), selection.catalog, question, confirm, inputs, { messages: [] });
        expect(results[0]?.outcome.kind).toBe('failed');
        expect(selection.read()).toEqual([]);
      }),
    );
    it.effect(
      'a resumed door carrying the parked resolution runs those targets',
      Effect.fnUntraced(function* () {
        const { open } = yield* questionDoor;
        const selection = selecting();
        const parked = open();
        const question = yield* selection.ask(parked);
        const answering = open({ resolutions: parked.resolutionsOf(['tool-1']) });
        yield* readApprovedCalls(answering, selection.catalog, question, confirm, inputs);
        const results = yield* toolResultsFromQuestion(answering, selection.catalog, question, confirm, inputs, { messages: [] });
        expect(results[0]?.outcome).toEqual({ kind: 'answered', output: { read: ['thread-a'] } });
      }),
    );
    it.effect(
      'refuses a resolution for other arguments without executing it',
      Effect.fnUntraced(function* () {
        const { open } = yield* questionDoor;
        const selection = selecting();
        const parked = open();
        const question = yield* selection.ask(parked);
        const elsewhere = parked.resolutionsOf(['tool-1']).map((resolution) => ({ ...resolution, input: { of: 'root-2' } }));
        const results = yield* toolResultsFromQuestion(open({ resolutions: elsewhere }), selection.catalog, question, confirm, inputs, {
          messages: [],
        });
        expect(results[0]?.outcome.kind).toBe('failed');
        expect(selection.read()).toEqual([]);
      }),
    );
  });
});
const askedAt = new Date(0).toISOString();
const deleteCall = { runId: 'run-1', toolCallId: 'tool-1', toolName: 'delete_item', input: { id: 'item-1' } };
const deleteInputs = new Map([['tool-1', { id: 'item-1' }]]);
const inputs = new Map([['tool-1', { of: 'root-1' }]]);
const confirm = [{ questionId: 'tool-1', values: ['confirm'] }];
const questionFromCall = Effect.fnUntraced(function* (door: AgentToolDoor, catalog: ToolCatalog, call: AskedToolCall) {
  const tool = catalog[call.toolName];
  if (!tool) return null;
  yield* door.preflight({ name: call.toolName, tool, input: call.input, toolCallId: call.toolCallId });
  return toolQuestionFromCall(door, catalog, call, askedAt);
});
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
function selecting() {
  let members: readonly string[] = ['thread-a'];
  let read: readonly string[] = [];
  const catalog: ToolCatalog = {
    read_selection: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_IN_REVIEW,
      description: 'Read a selection.',
      parameters: Schema.Struct({ of: Schema.String }),
      prepare: () =>
        Effect.succeed({
          subjects: members.map((thread) => ({ kind: 'read' as const, value: `thread://owner/${thread}` })),
          prepared: members,
        }),
      execute: (_input, options) =>
        Effect.sync(() => {
          read = options.prepared;
          return { read };
        }),
      mutates: true,
      confirmation: { prompt: () => ({ summary: 'Read selection?' }), confirmLabel: 'Read' },
    }),
  };
  const ask = Effect.fnUntraced(function* (door: AgentToolDoor) {
    const question = yield* questionFromCall(door, catalog, {
      runId: 'run-1',
      toolCallId: 'tool-1',
      toolName: 'read_selection',
      input: { of: 'root-1' },
    });
    if (!question) return yield* Effect.die('Expected a selection question');
    members = ['thread-a', 'thread-b'];
    return question;
  });
  return { catalog, ask, read: () => read };
}
