import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { unthreadedCaller } from './testing/caller';
import { builtinMode } from './testing/modes';
import { Effect, Schema, Stream } from 'effect';
import { type LLMEvent, Usage } from '@runlith/llm/schema/events';
import type { LLMError } from '@runlith/llm/schema/errors';
import { Message } from '@runlith/llm/schema/messages';
import { Agent } from './Agent';
import {
  TOOL_SEARCH_TOOL,
  type ToolSearchResult,
  agentDeferredToolRule,
  agentDeferredTools,
  deferredToolsSection,
  foldedReferences,
  revealedDefinitionsSection,
  revealedDeferredToolNames,
  unrevealedDefinition,
} from './AgentDeferredTools';
import { vendorBoundaryMessage, vendorVisible } from './AgentSignal';
import { makeAgentRunner } from './AgentRunner';
import { RunStop } from './RunStop';
import { AgentRunState } from './AgentRunState';
import { AgentRuntimePolicy, agentStepToolPolicy } from './policy/AgentRuntimePolicy';
import { agentCatalog } from './AgentScope';
import type { ToolGrant } from '../catalog/resolveCatalog';
import { stepLimit } from './AgentStep';
import type { ModelRequest, ModelStreamInput } from './modelPort';
import type { ToolCatalog } from './ToolCatalog';
import { Tool, ToolAnswer, describedTool, toolExecute } from './tool';
import { renderWorldState } from './WorldState';
import { ASKS_NEVER } from '../permissions/vocabulary';
const deferredTool = (description: string) =>
  Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description,
    parameters: Schema.Struct({}),
    execute: () => Effect.succeed('ran'),
    exposure: 'deferred',
  });
const catalog: ToolCatalog = {
  read_file: Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Read a file.',
    parameters: Schema.Struct({}),
    execute: () => Effect.succeed(''),
  }),
  mcp__tagma__read_block: deferredTool('Read one block whole.\nEdges and anchors ride with it.'),
  mcp__tagma__search: deferredTool('Search block titles and bodies.'),
  mcp__calendar__create_event: deferredTool('Create a calendar event.'),
};
const search = Effect.fnUntraced(function* (
  query: string,
  messages: readonly Message[] = [],
  max_results?: number,
  over: ToolCatalog = catalog,
) {
  const run = toolExecute(agentDeferredTools(over)[TOOL_SEARCH_TOOL]!);
  if (!run) return yield* Effect.die('Expected an executable search tool.');
  const answered = yield* run({ query, max_results }, { toolCallId: 'search', caller: unthreadedCaller, messages });
  return (answered instanceof ToolAnswer ? answered.value : answered) as ToolSearchResult;
});
const revealing = (...names: string[]): Message[] => [
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        id: 'search-1',
        name: TOOL_SEARCH_TOOL,
        result: { type: 'json', value: { status: 'revealed', tools: names.map((name) => ({ name, description: '' })) } },
      },
    ],
  },
];
describe('tool_search', () => {
  it.effect(
    'selection distinguishes names, bounds its page and reveals companions without carrying schemas',
    Effect.fnUntraced(function* () {
      const selected = yield* search('select:mcp__tagma__read_block, mcp__nowhere__tool');
      expect(selected.tools).toEqual([{ name: 'mcp__tagma__read_block', description: 'Read one block whole.' }]);
      expect(selected.missing).toEqual(['mcp__nowhere__tool']);
      expect(selected.direct).toEqual([]);
      expect(selected.truncated).toEqual([]);
      expect(Object.keys(selected).sort()).toEqual(['direct', 'missing', 'note', 'status', 'tools', 'truncated']);
      expect(Object.keys(selected.tools[0]!).sort()).toEqual(['description', 'name']);
      const direct = yield* search(`select:read_file,${TOOL_SEARCH_TOOL},mcp__nowhere__tool`);
      expect(direct.direct).toEqual(['read_file', TOOL_SEARCH_TOOL]);
      expect(direct.missing).toEqual(['mcp__nowhere__tool']);
      expect(direct.tools).toEqual([]);
      const page = yield* search('select:mcp__calendar__create_event,mcp__tagma__search', [], 1);
      expect(page.tools.map((tool) => tool.name)).toEqual(['mcp__calendar__create_event']);
      expect(page.truncated).toEqual(['mcp__tagma__search']);
      const handing: ToolCatalog = {
        read_file: catalog.read_file!,
        find: { ...deferredTool('Find a thing.'), companions: ['open', 'read_file', 'nowhere'] },
        open: deferredTool('Open what find answered.'),
      };
      const companions = yield* search('select:find', [], undefined, handing);
      expect(companions.tools.map((tool) => tool.name)).toEqual(['find', 'open']);
      expect((yield* search('select:open', [], undefined, handing)).tools.map((tool) => tool.name)).toEqual(['open']);
    }),
  );
  it.effect(
    'keyword ranking requires name terms and omits direct and already revealed tools',
    Effect.fnUntraced(function* () {
      expect((yield* search('+tagma read')).tools.map((tool) => tool.name)).toEqual(['mcp__tagma__read_block', 'mcp__tagma__search']);
      expect((yield* search('+calendar read')).tools.map((tool) => tool.name)).toEqual(['mcp__calendar__create_event']);
      expect((yield* search('+nowhere read')).tools).toEqual([]);
      expect((yield* search('file')).tools).toEqual([]);
      const history = revealing('mcp__tagma__read_block');
      expect((yield* search('tagma', history)).tools.map((tool) => tool.name)).toEqual(['mcp__tagma__search']);
      expect((yield* search('select:mcp__tagma__read_block', history)).tools.map((tool) => tool.name)).toEqual(['mcp__tagma__read_block']);
    }),
  );
});
describe('the reveal lock', () => {
  const names = () => [...Object.keys(catalog), TOOL_SEARCH_TOOL];
  it.effect(
    'hides every deferred tool no result in history has named, and only those',
    Effect.fnUntraced(function* () {
      const policy = new AgentRuntimePolicy<unknown>([agentDeferredToolRule(() => catalog)]);
      const evaluate = (modelMessages: readonly Message[]) =>
        policy.evaluate({
          hook: 'beforeStep',
          runId: 'run-1',
          run: new AgentRunState(),
          modelMessages,
          invocationKey: 'step:0',
          ordinal: 1,
        });
      const locked = agentStepToolPolicy(yield* evaluate([Message.user('Go.')]), names());
      expect(locked.activeTools).toEqual(['read_file', TOOL_SEARCH_TOOL]);
      const partly = agentStepToolPolicy(yield* evaluate([...revealing('mcp__tagma__search'), Message.user('Go.')]), names());
      expect(partly.activeTools).toEqual(['read_file', 'mcp__tagma__search', TOOL_SEARCH_TOOL]);
    }),
  );
  it.effect(
    'a catalog with nothing deferred answers without reading history',
    Effect.fnUntraced(function* () {
      let read = 0;
      const direct: ToolCatalog = { read_file: catalog.read_file! };
      const policy = new AgentRuntimePolicy<unknown>([agentDeferredToolRule(() => direct)]);
      const messages = new Proxy([Message.user('Go.')] as Message[], {
        get(target, key, receiver) {
          if (key !== 'constructor') read += 1;
          return Reflect.get(target, key, receiver);
        },
      });
      const directives = yield* policy.evaluate({
        hook: 'beforeStep',
        runId: 'run-1',
        run: new AgentRunState(),
        modelMessages: messages,
        invocationKey: 'step:0',
        ordinal: 1,
      });
      expect(directives).toEqual([]);
      expect(read).toBe(0);
    }),
  );
  test('the catalog carries the search tool beside a deferred tool when granted, and only then', () => {
    const granting = (tools: ToolCatalog, grant?: ToolGrant) =>
      agentCatalog(
        new Agent({
          id: 'deferred',
          name: 'Deferred',
          description: '',
          instructions: () => '',
          tools: () => tools,
          grant,
          stopWhen: [],
        }),
        {},
      );
    const searching: ToolGrant = { sources: [{ source: 'deferred' }, { source: TOOL_SEARCH_TOOL }] };
    expect(Object.keys(granting(catalog, searching).catalog).sort()).toEqual([...Object.keys(catalog), TOOL_SEARCH_TOOL].sort());
    expect(Object.keys(granting({ read_file: catalog.read_file! }, searching).catalog)).toEqual(['read_file']);
    expect(granting(catalog).withheld).toEqual([{ name: TOOL_SEARCH_TOOL, reason: 'not-granted' }]);
    expect(Object.keys(granting(catalog).catalog).sort()).toEqual(Object.keys(catalog).sort());
    expect(() => granting({ ...catalog, [TOOL_SEARCH_TOOL]: catalog.read_file! }, searching)).toThrow(
      `Duplicate agent tool: ${TOOL_SEARCH_TOOL}`,
    );
  });
  test('a definition that grants no search leaves a deferred tool held back with the reason', () => {
    const withheld = agentCatalog(
      new Agent({
        id: 'deferred',
        name: 'Deferred',
        description: '',
        instructions: () => '',
        tools: () => catalog,
        grant: { sources: [{ source: 'deferred', tools: ['read_file'] }] },
        stopWhen: [],
      }),
      {},
    ).withheld;
    expect(withheld).toContainEqual({ name: 'mcp__tagma__search', reason: 'not-granted' });
  });
});
describe('a run over deferred tools', () => {
  type Offered = {
    readonly names: readonly string[];
    readonly active: readonly string[] | undefined;
  };
  const scripted = (
    turns: readonly (readonly LLMEvent[])[],
  ): {
    offered: Offered[];
    request: ModelRequest;
  } => {
    const offered: Offered[] = [];
    const request: ModelRequest = {
      plannedOutputTokens: 1_000,
      text: () => Effect.die(new Error('never opened')),
      object: () => Effect.die(new Error('never opened')),
      stream: (input: ModelStreamInput) =>
        Stream.suspend(() => {
          offered.push({ names: Object.keys(input.tools), active: input.activeTools });
          return Stream.fromIterable(turns[offered.length - 1] ?? textTurn('Nothing scripted.')) as Stream.Stream<LLMEvent, LLMError>;
        }),
    };
    return { offered, request };
  };
  const usage = new Usage({
    inputTokens: 1,
    nonCachedInputTokens: 1,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 1,
    reasoningTokens: 0,
    totalTokens: 2,
  });
  const textTurn = (text: string): LLMEvent[] => [
    { type: 'step-start', index: 0 },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', text },
    { type: 'text-end', id: 't' },
    { type: 'step-finish', index: 0, reason: 'stop' },
    { type: 'finish', reason: 'stop', usage },
  ];
  const toolTurn = (name: string, input: unknown): LLMEvent[] => [
    { type: 'step-start', index: 0 },
    { type: 'tool-input-start', id: 'c1', name },
    { type: 'tool-call', id: 'c1', name, input },
    { type: 'step-finish', index: 0, reason: 'tool-calls' },
    { type: 'finish', reason: 'tool-calls', usage },
  ];
  const agent = new Agent<Record<string, never>>({
    id: 'deferred',
    name: 'Deferred',
    description: 'Offers one direct and three deferred tools.',
    instructions: () => 'Work.',
    tools: () => catalog,
    grant: { sources: [{ source: 'deferred' }, { source: TOOL_SEARCH_TOOL }] },
    stopWhen: [stepLimit(4)],
  });
  const run = Effect.fnUntraced(function* (turns: readonly (readonly LLMEvent[])[], messages: readonly Message[]) {
    const model = scripted(turns);
    const runner = yield* makeAgentRunner({ models: { request: () => model.request }, idleMs: 30_000 });
    const handle = yield* runner.run(
      agent,
      {
        runId: 'run-deferred',
        stop: new RunStop(),
        ctx: {},
        model: { ownerId: 'owner-1', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: null, switches: {} },
        messages,
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      },
      { push: () => Effect.void },
    );
    yield* handle.output.text;
    return { handle, offered: model.offered.map((call) => [...(call.active ?? call.names)].sort()) };
  });
  it.effect(
    'step 0 offers the search tool and no deferred definition; a revealing result offers it next',
    Effect.fnUntraced(function* () {
      const { handle, offered } = yield* run(
        [toolTurn(TOOL_SEARCH_TOOL, { query: 'select:mcp__tagma__read_block' }), textTurn('Done.')],
        [Message.user('Read a block.')],
      );
      expect(Object.keys(handle.catalog)).toContain(TOOL_SEARCH_TOOL);
      expect(offered).toEqual([
        ['read_file', TOOL_SEARCH_TOOL],
        ['mcp__tagma__read_block', 'read_file', TOOL_SEARCH_TOOL],
      ]);
    }),
  );
  it.effect(
    'a history that already carries the result offers the tool from the first step, and one without it hides it again',
    Effect.fnUntraced(function* () {
      const { offered: carried } = yield* run([textTurn('Done.')], [...revealing('mcp__calendar__create_event'), Message.user('Book it.')]);
      expect(carried).toEqual([['mcp__calendar__create_event', 'read_file', TOOL_SEARCH_TOOL]]);
      const { offered: compacted } = yield* run([textTurn('Done.')], [Message.user('Book it.')]);
      expect(compacted).toEqual([['read_file', TOOL_SEARCH_TOOL]]);
    }),
  );
  it.effect(
    'a persisted compaction checkpoint retains only discoveries admitted by the current catalog',
    Effect.fnUntraced(function* () {
      const checkpoint = Message.make({
        role: 'assistant',
        content: 'Continue the task.',
        compaction: {
          id: 'checkpoint',
          mode: 'manual',
          transcriptLocation: '/fixture/transcript.jsonl',
          preservedCount: 0,
          toolReferences: ['mcp__calendar__create_event', 'mcp__gone__tool'],
        },
      });
      const restored = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Message))(JSON.stringify(checkpoint));
      const { offered } = yield* run(
        [toolTurn('mcp__calendar__create_event', {}), textTurn('Done.')],
        [restored, Message.user('Book it.')],
      );
      expect(offered).toEqual([
        ['mcp__calendar__create_event', 'read_file', TOOL_SEARCH_TOOL],
        ['mcp__calendar__create_event', 'read_file', TOOL_SEARCH_TOOL],
      ]);
    }),
  );
});
describe('the deferred-tools section', () => {
  it.effect(
    'renders the names once, nothing while they stand, and their withdrawal when none is left',
    Effect.fnUntraced(function* () {
      const first = yield* renderWorldState([deferredToolsSection(catalog)], {});
      expect(first.kind).toBe('changed');
      if (first.kind !== 'changed') return;
      expect(first.text).toContain('- mcp__calendar__create_event\n- mcp__tagma__read_block\n- mcp__tagma__search');
      expect(first.text).not.toContain('read_file');
      expect(yield* renderWorldState([deferredToolsSection(catalog)], first.snapshot)).toEqual({
        kind: 'unchanged',
        snapshot: first.snapshot,
      });
      const gone = yield* renderWorldState([deferredToolsSection({ read_file: catalog.read_file! })], first.snapshot);
      expect(gone.kind).toBe('changed');
      if (gone.kind !== 'changed') return;
      expect(gone.snapshot).toEqual({});
      expect(yield* renderWorldState([deferredToolsSection({ read_file: catalog.read_file! })], {})).toEqual({
        kind: 'unchanged',
        snapshot: {},
      });
    }),
  );
});
describe('a vendor compaction without a retelling', () => {
  it.effect(
    'keeps what a search revealed before it, and the first context after it carries those definitions',
    Effect.fnUntraced(function* () {
      const before = revealing('mcp__tagma__read_block');
      const visible = vendorVisible([...before, vendorBoundaryMessage(foldedReferences(before)), Message.user('after')]);
      expect(revealedDeferredToolNames(catalog, visible)).toEqual(new Set(['mcp__tagma__read_block']));
      const told = yield* renderWorldState([revealedDefinitionsSection(catalog, visible)], {});
      expect(told.kind).toBe('changed');
      if (told.kind !== 'changed') return;
      const tool = catalog.mcp__tagma__read_block!;
      expect(told.text).toContain(
        JSON.stringify({ name: 'mcp__tagma__read_block', description: describedTool(tool), inputSchema: tool.inputSchema }),
      );
      expect(yield* renderWorldState([revealedDefinitionsSection(catalog, before)], {})).toEqual({ kind: 'unchanged', snapshot: {} });
    }),
  );
});
describe('revealedDeferredToolNames', () => {
  test('reads only deferred names out of tool_search results that still say what they mean', () => {
    const history: Message[] = [
      ...revealing('mcp__tagma__read_block', 'read_file', 'mcp__gone__tool'),
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: 'other',
            name: 'read_file',
            result: { type: 'json', value: { status: 'revealed', tools: [{ name: 'mcp__tagma__search' }] } },
          },
          { type: 'tool-result', id: 'text', name: TOOL_SEARCH_TOOL, result: { type: 'text', value: 'mcp__tagma__search' } },
        ],
      },
    ];
    expect(revealedDeferredToolNames(catalog, history)).toEqual(new Set(['mcp__tagma__read_block']));
  });
  test('a cleared search result still reveals through the references its clearing carried', () => {
    const history: Message[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: 'search-1',
            name: TOOL_SEARCH_TOOL,
            result: { type: 'text', value: '[Old tool result content cleared]' },
            toolReferences: ['mcp__tagma__read_block', 'mcp__gone__tool'],
          },
        ],
      },
    ];
    expect(revealedDeferredToolNames(catalog, history)).toEqual(new Set(['mcp__tagma__read_block']));
  });
});
describe('unrevealedDefinition', () => {
  test('a deferred tool called before any search revealed it is answered with its input schema', () => {
    const tool = catalog.mcp__tagma__read_block!;
    expect(unrevealedDefinition('mcp__tagma__read_block', tool, [])?.schema).toEqual(tool.inputSchema);
    expect(unrevealedDefinition('mcp__tagma__read_block', tool, revealing('mcp__tagma__read_block'))).toBeNull();
    expect(unrevealedDefinition('read_file', catalog.read_file!, [])).toBeNull();
  });
});
