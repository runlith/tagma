import { openModelClient } from '@runlith/llm/models/client';
import { it } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { unthreadedCaller } from './testing/caller';
import { builtinMode } from './testing/modes';
import { Effect, Schema } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { recordedRegistrations } from '@runlith/builtin-catalog/registrations';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { Agent } from './Agent';
import { makeAgentRunner } from './AgentRunner';
import { recordRun } from './testing/recording';
import { modelRequester } from './ModelRequests';
import { Message } from '@runlith/llm/schema/messages';
import { AgentRunState } from './AgentRunState';
import { AgentRuntimePolicy, agentStepToolPolicy } from './policy/AgentRuntimePolicy';
import { type AgentSkillPool, agentSkillTools, agentSkillRule } from './AgentSkill';
import { LOAD_SKILL_TOOL } from './skillWords';
import { agentSkillRequestRule } from './agentSkillRequests';
import { agentRuntimeGuidanceMessage, agentSignalMessage, withAgentOrigin } from './AgentSignal';
import { USER_MESSAGE_SIGNAL_TYPE } from './contracts';
import { Tool, ToolAnswer, toolExecute } from './tool';
import { projectThreadHistory } from '../thread/compaction/projection';
import { answering } from '@runlith/llm/route/transport/answering';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';
type Context = {
  revision: string;
};
const pool = [
  { id: 'writer', description: 'Write.', instructions: (ctx: Context) => `Writer ${ctx.revision}` },
  { id: 'reader', description: 'Read.', instructions: () => 'Reader instructions' },
] satisfies AgentSkillPool<Context>;
function policy(messages: readonly Message[], revision = 'current') {
  return new AgentRuntimePolicy([agentSkillRequestRule(pool)])
    .evaluate({
      revision,
      modelMessages: messages,
      hook: 'beforeStep',
      run: new AgentRunState(),
      runId: 'run',
      invocationKey: 'step:0',
      ordinal: 1,
    })
    .pipe(Effect.map((directives) => agentStepToolPolicy(directives, [LOAD_SKILL_TOOL, 'read_file'])));
}
const load = Effect.fnUntraced(function* (id: string, messages: readonly Message[]) {
  const execute = toolExecute(agentSkillTools(pool, { revision: 'current' })[LOAD_SKILL_TOOL]!);
  if (!execute) return yield* Effect.die('The skill loader must be executable.');
  const result = yield* execute({ skill: id }, { toolCallId: id, caller: unthreadedCaller, messages });
  return [
    ...messages,
    Message.assistant([{ type: 'tool-call', name: LOAD_SKILL_TOOL, id, input: { skill: id } }]),
    Message.tool({ name: LOAD_SKILL_TOOL, id, result: result instanceof ToolAnswer ? result.value : result }),
  ];
});
describe('explicit skill requests', () => {
  it.effect.each([
    { model: 'claude-fable-5-1', outcome: 'loaded', forced: false },
    { model: 'claude-haiku-5-5', outcome: 'loaded', forced: true },
    { model: 'claude-fable-5-1', outcome: 'refused', forced: false },
    { model: 'claude-fable-5-1', outcome: 'text', forced: false },
  ] as const)(
    '$model skill request can finish with $outcome through the real wire boundary',
    Effect.fnUntraced(function* ({ model, outcome, forced }) {
      const credentials: ModelCredentials = {
        apiKey: async () => 'test-key',
        accessToken: async () => 'test-token',
        credential: async () => ({
          accessToken: 'token',
          refreshToken: 'test-identity',
          expiresAt: 0,
          scope: '',
          account: { uuid: 'test-account', email: 'test@example.com' },
          organization: { uuid: 'organization-uuid', name: '' },
          accountId: undefined,
        }),
      };
      let written = '';
      const skills = [
        {
          id: 'writer',
          description: 'Write an artifact.',
          instructions: () => {
            if (outcome === 'refused') throw new Error('Instructions unavailable.');
            return 'Write using the artifact tool.';
          },
          tools: () => ({
            write_artifact: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Write an artifact.',
              parameters: Schema.Struct({ content: Schema.String }),
              execute: ({ content }) =>
                Effect.sync(() => {
                  written = content;
                  return { content };
                }),
            }),
          }),
        },
      ] satisfies AgentSkillPool<Record<string, never>>;
      type Wire = {
        tool_choice?: {
          type: string;
          name?: string;
        };
        tools?: {
          name: string;
        }[];
      };
      const requests: Wire[] = [];
      const fetch = answering((request) => {
        const path = new URL(request.url).pathname;
        const body = JSON.parse(request.text) as Wire;
        requests.push(body);
        const call =
          requests.length === 1 && outcome !== 'text'
            ? { name: LOAD_SKILL_TOOL, input: { skill: 'writer' } }
            : requests.length === 2 && outcome === 'loaded'
              ? { name: 'write_artifact', input: { content: 'artifact result' } }
              : null;
        const events = [
          { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          {
            type: 'content_block_start',
            index: 0,
            content_block: call
              ? { type: 'tool_use', id: `call-${requests.length}`, name: call.name, input: {} }
              : { type: 'text', text: '' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: 'Done.' },
          },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ];
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
      });
      const agent = new Agent({
        id: 'requesting',
        name: 'Requesting',
        description: 'Uses requested skills.',
        stopWhen: [],
        instructions: () => 'Follow reader requests.',
        tools: (ctx: Record<string, never>) => agentSkillTools(skills, ctx),
        rules: [agentSkillRequestRule(skills), agentSkillRule(skills)],
      });
      const models = modelRequester(modelCatalog([recordedRegistrations.subscription]), credentials, yield* openModelClient(fetch));
      const runner = yield* makeAgentRunner({ models, idleMs: 30_000 });
      const handle = yield* recordRun(runner, agent, {
        runId: 'skill-choice',
        ctx: {},
        model: { ownerId: 'owner', provider: 'subscription', model, reasoning: null, switches: {} },
        messages: [Message.user('Use $writer.')],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      });
      expect(yield* handle.output.text).toBe('Done.');
      expect(requests[0]?.tool_choice).toEqual(forced ? { type: 'tool', name: LOAD_SKILL_TOOL } : undefined);
      const loaderTools = [LOAD_SKILL_TOOL];
      const loadedTools = [LOAD_SKILL_TOOL, 'write_artifact'];
      expect(requests.map((request) => request.tools?.map((tool) => tool.name).sort())).toEqual(
        outcome === 'loaded' ? [loaderTools, loadedTools, loadedTools] : outcome === 'refused' ? [loaderTools, loaderTools] : [loaderTools],
      );
      expect(written).toBe(outcome === 'loaded' ? 'artifact result' : '');
      expect(handle.guidance[0]?.ruleIds).toEqual(['explicit-skills']);
      expect(handle.completedSteps().length).toBe(outcome === 'loaded' ? 3 : outcome === 'refused' ? 2 : 1);
    }),
  );
  it.effect(
    'requested payloads must be current and visible, including after compaction',
    Effect.fnUntraced(function* () {
      const input = [Message.user('Use $writer and $reader. Again $writer.')];
      expect((yield* policy(input)).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      const one = yield* load('writer', input);
      expect((yield* policy(one)).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      const both = yield* load('reader', one);
      expect((yield* policy(both)).toolChoice).toBeNull();
      expect((yield* policy(both, 'edited')).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      expect((yield* policy(input)).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      const loaded = yield* load('writer', [Message.user('Use $writer.')]);
      const compacted = projectThreadHistory(
        loaded,
        { coveredMessageCount: loaded.length, summary: 'A summary can quote $reader without requesting it.' },
        'Earlier history was compacted.',
        { maxOpeningTokens: 0, imageTokens: 0 },
      );
      expect((yield* policy(compacted)).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      const reloaded = yield* load('writer', compacted);
      expect((yield* policy(reloaded)).toolChoice).toBeNull();
      const again = projectThreadHistory(
        compacted,
        { coveredMessageCount: compacted.length, summary: 'Continue.' },
        'Earlier history was compacted.',
        { maxOpeningTokens: 0, imageTokens: 0 },
      );
      expect((yield* policy(again)).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      expect((yield* policy([...again, Message.user('Answer without a skill.')])).toolChoice).toBeNull();
    }),
  );
  it.effect(
    'a skill taking arguments loads with the requesting message as $ARGUMENTS, and counts as loaded after',
    Effect.fnUntraced(function* () {
      const commands: AgentSkillPool<Context> = [
        { id: 'fix', description: 'Fix.', arguments: true, instructions: () => 'Fix $ARGUMENTS; keep $1.' },
      ];
      const execute = toolExecute(agentSkillTools(commands, { revision: 'current' })[LOAD_SKILL_TOOL]!);
      if (!execute) return yield* Effect.die('The skill loader must be executable.');
      const asked = [
        Message.user('Earlier: $fix the footer'),
        agentSignalMessage({
          id: 'steer',
          type: USER_MESSAGE_SIGNAL_TYPE,
          text: 'please $fix the login page',
          addressee: 'reader',
          occurredAt: '2026-09-06T04:00:01Z',
        }),
      ];
      const result = yield* execute({ skill: 'fix' }, { toolCallId: 'fix', caller: unthreadedCaller, messages: asked });
      const value = (result instanceof ToolAnswer ? result.value : result) as { instructions: string };
      expect(value.instructions).toBe('Fix please the login page; keep $1.');
      const loaded = [
        ...asked,
        Message.assistant([{ type: 'tool-call', name: LOAD_SKILL_TOOL, id: 'fix', input: { skill: 'fix' } }]),
        Message.tool({ name: LOAD_SKILL_TOOL, id: 'fix', result: value }),
      ];
      const directives = yield* new AgentRuntimePolicy([agentSkillRequestRule(commands)]).evaluate({
        revision: 'current',
        modelMessages: loaded,
        hook: 'beforeStep',
        run: new AgentRunState(),
        runId: 'run',
        invocationKey: 'step:0',
        ordinal: 1,
      });
      expect(agentStepToolPolicy(directives, [LOAD_SKILL_TOOL]).toolChoice).toBeNull();
      const folded = projectThreadHistory(
        [...asked, Message.user('Now $reader too.')],
        { coveredMessageCount: 3, summary: 'Earlier work.' },
        'Earlier history was compacted.',
        { maxOpeningTokens: 0, imageTokens: 0 },
      );
      const after = yield* execute({ skill: 'fix' }, { toolCallId: 'again', caller: unthreadedCaller, messages: folded });
      expect(((after instanceof ToolAnswer ? after.value : after) as { instructions: string }).instructions).toBe(
        'Fix please the login page; keep $1.',
      );
    }),
  );
  it.effect(
    'only named skills in the latest reader input become requests',
    Effect.fnUntraced(function* () {
      expect((yield* policy([Message.user('The resolver reads $ref and $state(0).')])).toolChoice).toBeNull();
      expect((yield* policy([Message.user('Resolve $ref with $writer.')])).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      const messages = [
        Message.user('Keep `$writer` literal and pay $100.'),
        withAgentOrigin(Message.user('$reader'), 'orientation'),
        agentRuntimeGuidanceMessage('$reader'),
        withAgentOrigin(Message.user('$reader'), 'summary'),
        agentSignalMessage({ id: 'report', type: 'report', text: '$reader', addressee: 'transport', occurredAt: '2026-09-06T04:00:00Z' }),
      ];
      expect((yield* policy(messages)).toolChoice).toBeNull();
      const steered = [
        ...messages,
        agentSignalMessage({
          id: 'steer',
          type: USER_MESSAGE_SIGNAL_TYPE,
          text: '$writer now',
          addressee: 'reader',
          occurredAt: '2026-09-06T04:00:01Z',
        }),
      ];
      expect((yield* policy(steered)).toolChoice).toEqual({ type: 'tool', toolName: LOAD_SKILL_TOOL });
      expect((yield* policy([...steered, Message.user('Answer normally.')])).toolChoice).toBeNull();
    }),
  );
});
