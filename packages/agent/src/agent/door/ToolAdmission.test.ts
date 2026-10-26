import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Schema } from 'effect';
import type { ApprovalMode } from '../../modes/ApprovalMode';
import type { AgentToolInvocation } from './types';
import { builtinModes, bypass, review } from '../../modes/builtin';
import { Tool } from '../tool';
import { call, countingTool, open, verdict, WRITES_ONE_FILE } from './testing/open';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../permissions/vocabulary';
describe('ToolAdmission', () => {
  it.effect(
    'arguments the schema refuses are refused before permission projects a subject from them',
    Effect.fnUntraced(function* () {
      let projected = 0;
      let runs = 0;
      const { door } = open();
      const typed = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Write a named file.',
        parameters: Schema.Struct({ filePath: Schema.String }),
        execute: () =>
          Effect.sync(() => {
            runs += 1;
            return { written: true };
          }),
        subjects: (input) => {
          projected += 1;
          return [{ kind: 'write' as const, value: input.filePath.toLowerCase() }];
        },
      });
      const outcome = yield* Effect.flip(
        door.settle({ name: 'write_file', tool: typed, input: null, options: { toolCallId: 'call-1', messages: [] } }),
      );
      expect(runs).toBe(0);
      expect(projected).toBe(0);
      expect(outcome).toMatchObject({ _tag: 'AgentToolFailed', cause: { _tag: 'Tool.ArgumentsInvalid', code: 'body-shape' } });
    }),
  );
  it.effect(
    'only a door told the catalog names the sibling that takes a miscalled tool’s arguments',
    Effect.fnUntraced(function* () {
      const edit = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Edit a file.',
        parameters: Schema.Struct({ filePath: Schema.String, oldString: Schema.String, newString: Schema.String }),
        execute: () => Effect.succeed({ edited: true }),
      });
      const editBlock = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Edit a block.',
        parameters: Schema.Struct({ blockId: Schema.String, oldString: Schema.String, newString: Schema.String }),
        execute: () => Effect.succeed({ edited: true }),
      });
      const input = { blockId: 'a1', oldString: 'x', newString: 'y' };
      const catalog = new Map<string, Tool.Tool>([
        ['edit', edit],
        ['edit_block', editBlock],
      ]);
      const told = yield* Effect.flip(
        open({ catalog }).door.settle({ name: 'edit', tool: edit, input, options: { toolCallId: 'call-1', messages: [] } }),
      );
      const untold = yield* Effect.flip(
        open().door.settle({ name: 'edit', tool: edit, input, options: { toolCallId: 'call-2', messages: [] } }),
      );
      expect(told).toMatchObject({ cause: { _tag: 'Tool.ArgumentsInvalid', sibling: 'edit_block' } });
      expect(untold).toMatchObject({ cause: { _tag: 'Tool.ArgumentsInvalid', sibling: undefined } });
    }),
  );
  it.effect(
    'a subject projection defect is a typed failure naming its tool and projection',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const { door } = open();
      const cause = new Error('subject projection broke');
      const projecting = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Projects a permission subject.',
        parameters: Schema.Struct({ path: Schema.String }),
        subjects: () => {
          throw cause;
        },
        execute: () =>
          Effect.sync(() => {
            runs += 1;
            return { written: true };
          }),
      });
      const outcome = yield* Effect.flip(
        door.settle({
          name: 'write_file',
          tool: projecting,
          input: { path: 'notes/today.md' },
          options: { toolCallId: 'call-subject', messages: [] },
        }),
      );
      expect(runs).toBe(0);
      expect(outcome).toMatchObject({
        _tag: 'AgentToolFailed',
        toolName: 'write_file',
        toolCallId: 'call-subject',
        projection: 'subjects',
        cause,
      });
    }),
  );
  it.effect(
    'a refusal over wrong arguments carries the keys the call actually sent',
    Effect.fnUntraced(function* () {
      const { door } = open();
      const typed = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Replace a run of text.',
        parameters: Schema.Struct({ oldString: Schema.String, newString: Schema.String }),
        execute: () => Effect.succeed({ replaced: true }),
      });
      const outcome = yield* Effect.flip(
        door.settle({ name: 'edit', tool: typed, input: { old: 'a', new: 'b' }, options: { toolCallId: 'call-2', messages: [] } }),
      );
      expect(outcome).toMatchObject({ cause: { _tag: 'Tool.ArgumentsInvalid', arrived: ['old', 'new'] } });
    }),
  );
  it.effect(
    'an argument the schema does not declare is refused, never silently dropped',
    Effect.fnUntraced(function* () {
      const { door } = open();
      let ran = 0;
      const typed = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Replace a run of text.',
        parameters: Schema.Struct({ oldString: Schema.String, newString: Schema.String, replaceAll: Schema.optional(Schema.Boolean) }),
        execute: () => {
          ran += 1;
          return Effect.succeed({ replaced: true });
        },
      });
      const outcome = yield* Effect.flip(
        door.settle({
          name: 'edit',
          tool: typed,
          input: { oldString: 'a', newString: 'b', all: true },
          options: { toolCallId: 'call-3', messages: [] },
        }),
      );
      expect(ran).toBe(0);
      expect(outcome).toMatchObject({
        cause: { _tag: 'Tool.ArgumentsInvalid', code: 'body-shape', arrived: ['oldString', 'newString', 'all'] },
      });
    }),
  );
  it.effect(
    'a tool that takes no arguments refuses one without executing',
    Effect.fnUntraced(function* () {
      const { door } = open();
      let ran = 0;
      const nullary = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'List what runs here.',
        parameters: Schema.Struct({}),
        execute: () => {
          ran += 1;
          return Effect.succeed({ rows: [] });
        },
      });
      const outcome = yield* Effect.flip(
        door.settle({
          name: 'list_agents',
          tool: nullary,
          input: { agents: 'all' },
          options: { toolCallId: 'call-nullary', messages: [] },
        }),
      );
      expect(ran).toBe(0);
      expect(outcome).toMatchObject({ cause: { _tag: 'Tool.ArgumentsInvalid', code: 'body-shape', arrived: ['agents'] } });
    }),
  );
  function resolvingTool(input: {
    readonly asks?: true;
    readonly resolve: () => Effect.Effect<readonly string[], Tool.ToolFailed>;
    readonly run?: (prepared: readonly string[]) => void;
  }) {
    return Tool.make({
      display: () => ({ form: 'none' }),
      approval: input.asks === true ? ASKS_IN_REVIEW : ASKS_NEVER,
      description: 'Read what a selector names.',
      parameters: Schema.Struct({ of: Schema.String }),
      prepare: () =>
        Effect.map(input.resolve(), (threads) => ({
          subjects: threads.map((thread) => ({ kind: 'read' as const, value: `thread://owner/${thread}` })),
          prepared: threads,
        })),
      execute: (_arguments, options) =>
        Effect.sync(() => {
          input.run?.(options.prepared);
          return { read: options.prepared };
        }),
    });
  }
  const selecting = (tool: Tool, toolCallId = 'call-1', confirmed?: true): AgentToolInvocation => ({
    name: 'read_selection',
    tool,
    input: { of: 'root-1' },
    confirmed,
    options: { toolCallId, messages: [] },
  });
  it.effect(
    'the resolution the rules were asked about is the one the body receives',
    Effect.fnUntraced(function* () {
      let seen: readonly string[] = [];
      const { door } = open();
      const tool = resolvingTool({
        resolve: () => Effect.succeed(['one', 'two']),
        run: (prepared) => {
          seen = prepared;
        },
      });
      const outcome = yield* door.settle(selecting(tool, 'call-carried'));
      expect(outcome.executed).toBe(true);
      expect(seen).toEqual(['one', 'two']);
      expect(outcome.output).toEqual({ read: ['one', 'two'] });
    }),
  );
  it.effect(
    'a resolution that fails executes nothing and keeps its own failure',
    Effect.fnUntraced(function* () {
      let ran = 0;
      const { door } = open();
      const cause = new Tool.ToolFailed({ reason: 'the thread list could not be read' });
      const tool = resolvingTool({
        resolve: () => Effect.fail(cause),
        run: () => {
          ran += 1;
        },
      });
      expect(yield* Effect.flip(door.settle(selecting(tool, 'call-unresolved')))).toMatchObject({ _tag: 'AgentToolFailed', cause });
      expect(ran).toBe(0);
    }),
  );
  it.effect(
    'an approval whose resolution this door no longer holds refuses instead of resolving again',
    Effect.fnUntraced(function* () {
      let ran = 0;
      const { door } = open({ mode: 'review' });
      const tool = resolvingTool({
        asks: true,
        resolve: () => Effect.succeed(['one']),
        run: () => {
          ran += 1;
        },
      });
      expect(yield* Effect.flip(door.settle(selecting(tool, 'call-recovered', true)))).toMatchObject({
        _tag: 'AgentToolFailed',
        toolCallId: 'call-recovered',
        cause: { _tag: 'Tool.Failed' },
      });
      expect(ran).toBe(0);
    }),
  );
  it.effect(
    'a call the rules want a reader for refuses to run without that answer, and runs with it',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const asking = () =>
        call(
          countingTool(() => {
            runs += 1;
          }),
          { declares: WRITES_ONE_FILE, toolCallId: 'call-ask' },
        );
      const { door } = open({ mode: 'review' });
      expect((yield* verdict(door, asking())).verdict).toBe('ask');
      const failed = yield* Effect.exit(door.settle(asking()));
      expect(Exit.isFailure(failed) && Cause.hasDies(failed.cause)).toBe(true);
      expect(runs).toBe(0);
      const { door: answered } = open({ mode: 'review' });
      const outcome = yield* answered.settle({ ...asking(), confirmed: true });
      expect(runs).toBe(1);
      expect(outcome.executed).toBe(true);
    }),
  );
  it.effect(
    'the trusting mode asks nobody about the same call',
    Effect.fnUntraced(function* () {
      const { door } = open({ mode: 'trust' });
      expect(
        (yield* verdict(
          door,
          call(
            countingTool(() => undefined),
            { declares: WRITES_ONE_FILE },
          ),
        )).verdict,
      ).toBe('allow');
    }),
  );
  it.effect(
    'a going run is judged by the thread’s live mode, not the copy the run opened with',
    Effect.fnUntraced(function* () {
      let runs = 0;
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Run one command.',
        parameters: Schema.Struct({ command: Schema.String }),
        execute: () =>
          Effect.sync(() => {
            runs += 1;
            return { ok: true };
          }),
        prepare: () => Effect.succeed({ subjects: [{ kind: 'execute' as const, value: 'git commit -m x' }] }),
      });
      const asking = (toolCallId: string) => ({
        name: 'sweep',
        tool,
        input: { command: 'git commit -m x' },
        options: { toolCallId, messages: [] },
      });
      const asks: ApprovalMode[] = [review];
      const { door } = open({ mode: 'review', modeOf: Object.assign(() => asks[0]!, { modes: builtinModes }) });
      expect((yield* verdict(door, asking('call-before'))).verdict).toBe('ask');
      asks[0] = bypass;
      expect((yield* verdict(door, asking('call-after'))).verdict).toBe('allow');
      const settled = yield* door.settle(asking('call-after'));
      expect(runs).toBe(1);
      expect(settled.executed).toBe(true);
      expect((yield* verdict(open({ mode: 'review' }).door, asking('call-copy'))).verdict).toBe('ask');
    }),
  );
});
