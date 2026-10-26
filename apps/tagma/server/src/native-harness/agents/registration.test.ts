import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema, Stream } from 'effect';
import { modeOfLookup } from '@runlith/agent/modes/ApprovalMode';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { Agent } from '@runlith/agent/Agent';
import { type AgentRunner, makeAgentRunner } from '@runlith/agent/AgentRunner';
import { RunStop } from '@runlith/agent/RunStop';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { Tool } from '@runlith/agent/tool';
import { stepLimit } from '@runlith/agent/AgentStep';
import type { AgentToolOutputs } from '@runlith/agent/ToolOutput';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import { threadAgent, type ThreadPrepareInput, type ThreadRunInput, type ThreadView } from '@runlith/agent/thread/agents/ThreadAgent';
import { noSources } from '@runlith/agent/thread/conformance/agents';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../platform/contract/wire/conditions.js';
it.live('an unrelated registration executes and continues with its own frozen prompt and context', () =>
  Effect.gen(function* () {
    const notes: string[] = [];
    let role = 'first-role';
    let frozen: string | undefined;
    const sent: {
      instructions: string | undefined;
      tools: string[];
      messages: readonly Message[];
    }[] = [];
    const origin = new ModelIdentity({
      provider: ProviderID.make('openai-oauth'),
      model: ModelID.make('gpt-5.5'),
    });
    const usage = new Usage({
      inputTokens: 1,
      nonCachedInputTokens: 1,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      totalTokens: 2,
    });
    const runner = yield* makeAgentRunner({
      idleMs: 5_000,
      models: {
        request: (selection: ModelRequestInput) => ({
          system: selection.instructions,
          origin,
          plannedOutputTokens: 32,
          text: () => {
            throw new Error('the fixture opens streamed requests only');
          },
          object: () => {
            throw new Error('the fixture opens streamed requests only');
          },
          stream: (input: ModelStreamInput) =>
            Stream.suspend(() => {
              sent.push({
                instructions: selection.instructions,
                tools: Object.keys(input.tools),
                messages: input.messages,
              });
              const id = `call-${sent.length}`;
              const events: LLMEvent[] = [
                { type: 'step-start', index: 0 },
                { type: 'tool-input-start', id, name: 'remember' },
                {
                  type: 'tool-call',
                  id,
                  name: 'remember',
                  input: { text: sent.length === 1 ? 'one' : 'two' },
                },
                { type: 'step-finish', index: 0, reason: 'tool-calls' },
                { type: 'finish', reason: 'tool-calls', usage },
              ];
              return Stream.fromIterable(events);
            }),
        }),
      },
    });
    const definition = new Agent<{
      role: string;
    }>({
      id: 'notebook-fixture',
      name: 'Notebook fixture',
      description: 'A text-only fixture with one in-memory capability.',
      instructions: (ctx) => `Notebook ${ctx.role}.`,
      tools: (ctx) => ({
        remember: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Keep a note in this notebook.',
          parameters: Schema.Struct({ text: Schema.String }),
          execute: ({ text }) =>
            Effect.sync(() => {
              const note = `${ctx.role}:${text}`;
              notes.push(note);
              return note;
            }),
        }),
      }),
      stopWhen: [stepLimit(1)],
    });
    const registered = threadAgent({
      agent: definition,
      runner,
      runPolicy: { userStartable: true, backgroundStartable: false },
      context: () => Effect.succeed({ role }),
    });
    const at = new Date('2026-01-01T00:00:00Z');
    const thread: ThreadView = {
      id: 'notebook-thread',
      ownerId: 'fixture',
      agentId: definition.id,
      hostKind: null,
      hostId: null,
      bindings: {},
      cacheGroup: 'notebook-thread',
      capabilities: NATIVE_CAPABILITIES,
      account: null,
      provider: 'openai-oauth',
      model: 'gpt-5.5',
      reasoning: null,
      switches: {},
      status: 'running',
      profile: null,
      history: [],
      transcript: [],
      contextReading: null,
      authority: { mode: 'bypass', bypassFrom: 'notebook-thread' },
      createdAt: at,
      updatedAt: at,
    };
    const outputs: AgentToolOutputs = {
      project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
      projectMessages: (messages) => Effect.succeed(messages),
    };
    const input = (id: string, messages: readonly Message[]): ThreadRunInput & ThreadPrepareInput => ({
      thread,
      sink: { push: () => Effect.void },
      modeOf: modeOfLookup(builtinModeRegistry(), 'bypass'),
      stop: new RunStop(),
      run: {
        id,
        status: 'running',
        account: null,
        provider: 'openai-oauth',
        model: 'gpt-5.5',
        reasoning: null,
        switches: {},
        approvalMode: 'bypass',
        interactive: false,
      },
      model: {
        ownerId: 'fixture',
        provider: 'openai-oauth',
        model: 'gpt-5.5',
        reasoning: null,
        switches: {},
      },
      messages,
      signals: { drain: () => Effect.succeed([]), hasPending: () => Effect.succeed(false) },
      supply: { sources: noSources, outputTools: {} },
      context: {
        project: ({ messages }) => Effect.succeed({ messages }),
        lower: (messages) => Effect.succeed(messages),
        observe: () => Effect.succeed(undefined),
      },
      toolOutputs: outputs,
      ...(frozen === undefined
        ? {
            commitInstructions: (text: string) => Effect.sync(() => (frozen ??= text)),
          }
        : { instructions: frozen }),
    });
    const launch = (given: ThreadRunInput & ThreadPrepareInput) =>
      Effect.flatMap(registered.prepare(given), (prepared) => prepared.start(given));
    const first = yield* launch(input('first', [Message.user('Keep one note.')]));
    const firstResponse = yield* first.output.response;
    role = 'second-role';
    const second = yield* launch(
      input('second', [Message.user('Keep one note.'), ...firstResponse.messages, Message.user('Keep the next note.')]),
    );
    yield* second.output.response;
    expect(notes).toEqual(['first-role:one', 'second-role:two']);
    expect(sent.map(({ instructions, tools }) => ({ instructions, tools }))).toEqual([
      { instructions: 'Notebook first-role.', tools: ['remember'] },
      { instructions: 'Notebook first-role.', tools: ['remember'] },
    ]);
    const catalog = yield* registered.toolCatalog({
      thread,
      run: input('rebuild', []).run,
      supply: { sources: noSources, outputTools: {} },
    });
    expect(Object.keys(catalog)).toEqual(['remember']);
  }),
);
