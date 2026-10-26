import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { unthreadedCaller } from './testing/caller';
import { Cause, Effect, Exit, Schema } from 'effect';
import { Tool, ToolAnswer, ToolFailed, toolExecute, toolPartialDisplay } from './tool';
import { ToolArgumentsInvalid, toolArguments } from './ToolArguments';
import { ASKS_NEVER } from '../permissions/vocabulary';
const bash = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Run a command.',
  parameters: Schema.Struct({
    command: Schema.String,
    timeout: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    background: Schema.optional(Schema.Boolean),
  }),
});
const read = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Read a file.',
  parameters: Schema.Struct({ filePath: Schema.String, offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))) }),
});
const spawn = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Start an agent.',
  parameters: Schema.Struct({
    agentId: Schema.String,
    task: Schema.String,
    provider: Schema.optional(Schema.String),
    model: Schema.optional(Schema.Literals(['gpt-6-astra', 'claude-opus-5'])),
    reasoning: Schema.optional(Schema.String),
    host: Schema.optional(Schema.Struct({ kind: Schema.String, id: Schema.String })),
  }),
});
const worktree = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Prepare a worktree.',
  parameters: Schema.Union([
    Schema.Struct({ mode: Schema.tag('branch'), branch: Schema.String.annotate({ description: 'The branch to check out.' }) }),
    Schema.Struct({ mode: Schema.tag('detached'), start: Schema.String }),
  ]).pipe(Schema.toTaggedUnion('mode')),
});
const refusal = (source: Tool.Tool, name: string, input: unknown, catalog?: ReadonlyMap<string, Tool.Tool>) =>
  Effect.flip(toolArguments(source, name, input, catalog));
describe('toolArguments names what arrived', () => {
  it.effect.each([
    {
      name: 'read',
      tool: read,
      input: { filePath: '/x', offset: -1 },
      fault: { argument: 'offset', expected: 'a value greater than or equal to 0', sent: '-1' },
    },
    {
      name: 'bash',
      tool: bash,
      input: { command: 'ls', timeout: true },
      fault: { argument: 'timeout', expected: 'a number', sent: 'true' },
    },
    {
      name: 'bash',
      tool: bash,
      input: { command: 'ls', background: 'maybe' },
      fault: { argument: 'background', expected: 'a boolean', sent: 'the string "maybe"' },
    },
    {
      name: 'spawn_agent',
      tool: spawn,
      input: { agentId: 'code', task: 'go', host: { kind: 7 } },
      fault: { argument: 'host.kind', expected: 'a string', sent: '7' },
    },
    { name: 'bash', tool: bash, input: { timeout: 5 }, fault: { argument: 'command', expected: undefined, sent: undefined } },
  ])(
    'refused $name argument: $input',
    Effect.fnUntraced(function* ({ tool, name, input, fault }) {
      expect(yield* refusal(tool, name, input)).toMatchObject({ _tag: 'Tool.ArgumentsInvalid', code: 'body-shape', tool: name, ...fault });
    }),
  );
  it.effect(
    'an oversized arrived value is capped and the whole sentence stays short',
    Effect.fnUntraced(function* () {
      const model = 'y'.repeat(81);
      const invalid = yield* refusal(spawn, 'spawn_agent', { agentId: 'code', task: 'go', model });
      expect(invalid.sent).not.toContain(model);
      expect(invalid.message.length).toBeLessThan(300);
    }),
  );
  it.effect(
    'a tagged union answers with its selected variant and missing key',
    Effect.fnUntraced(function* () {
      const invalid = yield* refusal(worktree, 'prepare_worktree', { mode: 'branch' });
      expect(invalid.argument).toBeUndefined();
      expect(invalid.detail).toContain('mode');
      expect(invalid.detail).toContain('branch');
      expect(invalid.arrived).toEqual(['mode']);
    }),
  );
  it.effect(
    'an unknown argument is refused with the keys that arrived',
    Effect.fnUntraced(function* () {
      expect(yield* refusal(bash, 'bash', { command: 'ls', blockId: 'a1' })).toMatchObject({
        _tag: 'Tool.ArgumentsInvalid',
        code: 'body-shape',
        arrived: ['command', 'blockId'],
      });
    }),
  );
  it.effect(
    'a tool whose codec declares its wire form refuses the arguments',
    Effect.fnUntraced(function* () {
      const checked = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Run commands.',
        parameters: Schema.Unknown.check(Schema.makeFilter((input) => (Array.isArray(input) ? 'input must be an object' : true))),
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      });
      expect(yield* refusal(checked, 'checked', ['not', 'an', 'object'])).toBeInstanceOf(ToolArgumentsInvalid);
    }),
  );
});
const edit = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Edit a file.',
  parameters: Schema.Struct({
    filePath: Schema.String,
    oldString: Schema.String,
    newString: Schema.String,
    replaceAll: Schema.optional(Schema.Boolean),
  }),
});
const editBlock = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Edit a block body.',
  parameters: Schema.Struct({
    blockId: Schema.String,
    oldString: Schema.String,
    newString: Schema.String,
    checked: Schema.optional(Schema.Boolean),
  }),
});
const readBlock = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Read blocks.',
  parameters: Schema.Struct({ blockIds: Schema.Array(Schema.String), depth: Schema.optional(Schema.Int) }),
});
const searchBlocks = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Search blocks.',
  parameters: Schema.Struct({
    query: Schema.optional(Schema.String),
    kind: Schema.optional(Schema.String),
    cursor: Schema.optional(Schema.String),
  }),
});
const readPerformance = Tool.make({
  display: () => ({ form: 'none' }),
  approval: ASKS_NEVER,
  description: 'Read performance.',
  parameters: Schema.Struct({ type: Schema.String, name: Schema.String, limit: Schema.optional(Schema.Int) }),
});
const catalog = new Map<string, Tool.Tool>([
  ['bash', bash],
  ['read', read],
  ['edit', edit],
  ['edit_block', editBlock],
  ['read_block', readBlock],
  ['search_blocks', searchBlocks],
  ['read_performance', readPerformance],
  ['spawn_agent', spawn],
]);
describe('an unknown argument is routed to the owner that declares it', () => {
  it.effect(
    'a sibling is named only when it alone takes the call, including in the model dialect',
    Effect.fnUntraced(function* () {
      const input = { blockId: 'a1', oldString: 'x', newString: 'y' };
      expect((yield* refusal(edit, 'edit', input, catalog)).sibling).toBe('edit_block');
      expect((yield* refusal(read, 'read', { blockIds: 'a1' }, catalog)).sibling).toBe('read_block');
      const twin = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Edit a block, twice declared.',
        parameters: editBlock.parameters,
      });
      expect((yield* refusal(edit, 'edit', input, new Map(catalog).set('amend_block', twin))).sibling).toBeUndefined();
      expect((yield* refusal(edit, 'edit', input)).sibling).toBeUndefined();
      expect((yield* refusal(searchBlocks, 'search_blocks', { query: 'gate', limit: 5 }, catalog)).sibling).toBeUndefined();
    }),
  );
  it.effect(
    'a sibling that declares the key but would refuse the call is not named',
    Effect.fnUntraced(function* () {
      const readOutput = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Read a command.',
        parameters: Schema.Struct({ execution: Schema.String, incarnation: Schema.Int, wait: Schema.optional(Schema.Int) }),
      });
      const controlCall = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Control a call.',
        parameters: Schema.Struct({
          runId: Schema.String,
          toolCallId: Schema.String,
          control: Schema.Struct({ action: Schema.Literal('stop') }),
        }),
      });
      const calls = new Map([...catalog, ['read_output', readOutput], ['control_call', controlCall]]);
      expect((yield* refusal(readOutput, 'read_output', { runId: 'run-1' }, calls)).sibling).toBeUndefined();
    }),
  );
});
describe('a call in the model dialect is read as the call it meant', () => {
  const reflection = Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'File a reflection.',
    parameters: Schema.Struct({
      title: Schema.String,
      expected: Schema.String,
      actual: Schema.String,
      limit: Schema.optional(Schema.Int),
      body: Schema.optional(Schema.String),
    }),
  });
  it.effect(
    'parameter markup closes required arguments, while unknown and optional keys keep their original meaning',
    Effect.fnUntraced(function* () {
      const input = {
        title: 't',
        expected: 'it lands.</expected>\n<parameter name="actual">it refused.</expected>\n<parameter name="limit">5',
      };
      expect(yield* toolArguments(reflection, 'file_reflection', input)).toEqual({
        title: 't',
        expected: 'it lands.',
        actual: 'it refused.',
        limit: 5,
      });
      expect(
        (yield* refusal(reflection, 'file_reflection', { title: 't', expected: 'a</expected>\n<parameter name="verdict">b' })).argument,
      ).toBe('actual');
      const optional = { filePath: '/x', old_string: 'a', newString: 'b</newString>\n<parameter name="replaceAll">true' };
      expect(yield* toolArguments(edit, 'edit', optional)).toEqual({ filePath: '/x', oldString: 'a', newString: optional.newString });
      const unknown = JSON.parse('{"filePath":"/x","oldString":"a","new_string":"b","__proto__":"c"}');
      const invalid = yield* refusal(edit, 'edit', unknown);
      expect(invalid.detail).toContain('new_string');
      expect(invalid.detail).toContain('__proto__');
      expect(yield* toolArguments(edit, 'edit', { filePath: '/x', old_string: 'a', 'new String': 'b' })).toEqual({
        filePath: '/x',
        oldString: 'a',
        newString: 'b',
      });
    }),
  );
});
describe('a declared refusal', () => {
  const refusing = (code: string) =>
    Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Refuse.',
      parameters: Schema.Struct({}),
      refusals: { 'subject-moved': 'Subject moved' },
      execute: () => Effect.fail(new ToolFailed({ reason: 'it moved', code, unblock: ['read it', 'call again'] })),
    });
  const run = Effect.fnUntraced(function* (tool: Tool.Tool) {
    const execute = toolExecute(tool);
    if (!execute) return yield* Effect.die('The refusing tool must execute.');
    return yield* execute({}, { toolCallId: 'c1', caller: unthreadedCaller, messages: [] });
  });
  it.effect(
    'reaches its caller with its code, its declared words and ways out, including in the text projection',
    Effect.fnUntraced(function* () {
      const refused = yield* Effect.flip(run(refusing('subject-moved')));
      expect(refused.code).toBe('subject-moved');
      expect(refused.refusal?.words).toBe('Subject moved');
      expect(refused.unblock).toEqual(['read it', 'call again']);
      expect(refused.message).toContain('subject-moved');
      for (const way of ['read it', 'call again']) expect(refused.message).toContain(way);
    }),
  );
  test('a failure with no code reads as its reason alone', () => {
    const reason = 'nothing ran';
    expect(new ToolFailed({ reason }).message).toBe(reason);
  });
  it.effect(
    'a code the tool does not declare is a defect, never an answer',
    Effect.fnUntraced(function* () {
      const exit = yield* Effect.exit(run(refusing('something-else')));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );
});
const watched = Tool.make({
  approval: ASKS_NEVER,
  description: 'Watch a command.',
  parameters: Schema.Struct({ execution: Schema.String, incarnation: Schema.Int, waitMs: Schema.optional(Schema.Int) }),
  display: ({ execution, incarnation, waitMs }) => ({
    form: 'none',
    title: 'Waiting for a command',
    reference:
      execution === undefined || incarnation === undefined ? undefined : { kind: 'command', execution, incarnation, standing: false },
    awaitsMs: waitMs,
  }),
});
test('a field its own schema does not decode never reaches the display projection', () => {
  const display = toolPartialDisplay(watched, {
    value: { execution: 'one', incarnation: '167', waitMs: 240 },
    complete: true,
    completedFields: [],
  });
  expect(display?.reference).toBeUndefined();
  expect(display?.awaitsMs).toBe(240);
});
test('a partial call keeps its declared waiting budget beside the command reference', () => {
  const display = toolPartialDisplay(watched, {
    value: { execution: 'one', incarnation: 2, waitMs: 90_000 },
    complete: false,
    completedFields: ['execution', 'incarnation', 'waitMs'],
  });
  expect(display?.reference).toEqual({ kind: 'command', execution: 'one', incarnation: 2, standing: false });
  expect(display?.awaitsMs).toBe(90_000);
});
test('an answer rebuilt from its own options keeps its verdict and what it showed', () => {
  const shown = [{ path: 'src/a.ts', as: 'read' }] as const;
  const refused = new ToolAnswer(
    'ls: missing',
    { form: 'none' },
    { completion: 'command', shown, refusal: { code: 'exit', reason: 'status 1' } },
  );
  const ended = new ToolAnswer('stopped', { form: 'none' }, { ending: 'cancelled' });
  const answered = new ToolAnswer('ok', { form: 'none' });
  const again = (answer: ToolAnswer) => new ToolAnswer(answer.value, { form: 'text', text: 'shown again' }, answer.options);
  expect(again(refused)).toMatchObject({ verdict: refused.verdict, completion: 'command', shown });
  expect(again(ended).verdict).toEqual({ kind: 'cancelled' });
  expect(again(answered).verdict).toEqual({ kind: 'answered' });
});
