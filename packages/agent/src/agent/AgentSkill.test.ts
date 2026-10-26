import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { unthreadedCaller } from './testing/caller';
import { Effect, Schema } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { Tool } from './tool';
import { AgentRunState } from './AgentRunState';
import { agentStepToolPolicy, AgentRuntimePolicy } from './policy/AgentRuntimePolicy';
import { type AgentSkillPool, agentSkillRule, agentSkillTools, loadedAgentSkillIds } from './AgentSkill';
import { LOAD_SKILL_TOOL } from './skillWords';
import { ToolAnswer, toolExecute } from './tool';
import { ASKS_NEVER } from '../permissions/vocabulary';
const loaded = (answered: unknown): unknown => (answered instanceof ToolAnswer ? answered.value : answered);
type SkillContext = {
  readonly revision: string;
};
const skills = [
  {
    id: 'writer',
    description: 'Write a durable artifact.',
    instructions: (ctx: SkillContext) => `Writer instructions ${ctx.revision}.`,
    tools: () => ({
      write_artifact: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Write the requested artifact.',
        parameters: Schema.Struct({ content: Schema.String }),
        execute: ({ content }) => Effect.succeed({ content }),
      }),
    }),
  },
  {
    id: 'reviewer',
    description: 'Review an existing artifact.',
    location: '/skills/reviewer',
    instructions: (ctx: SkillContext) => `Reviewer instructions ${ctx.revision}.`,
  },
] satisfies AgentSkillPool<SkillContext, 'writer' | 'reviewer'>;
describe('agent skills', () => {
  test('an empty pool offers no loader or skill tools', () => {
    expect(Object.keys(agentSkillTools([], { revision: 'current' }))).toEqual([]);
  });
  it.effect(
    'loads current instructions with the folder they resolve in, and supports skills without tool packs',
    Effect.fnUntraced(function* () {
      const catalog = agentSkillTools(skills, { revision: 'current' });
      const loader = toolExecute(catalog[LOAD_SKILL_TOOL]!);
      if (!loader) return yield* Effect.die('Expected an executable skill loader.');
      const result = loaded(yield* loader({ skill: 'reviewer' }, { toolCallId: 'load-reviewer', caller: unthreadedCaller, messages: [] }));
      expect(result).toEqual({
        status: 'loaded',
        skill: 'reviewer',
        location: '/skills/reviewer',
        instructions: 'Reviewer instructions current.',
      });
      expect(Object.keys(catalog).sort()).toEqual([LOAD_SKILL_TOOL, 'write_artifact']);
    }),
  );
  it.effect(
    'gates skill tools by current instructions in model-visible history',
    Effect.fnUntraced(function* () {
      const context = { revision: 'current' };
      const history = skillLoadMessages('Writer instructions current.');
      const policy = new AgentRuntimePolicy<SkillContext>([agentSkillRule(skills)]);
      const run = new AgentRunState();
      expect(yield* loadedAgentSkillIds(skills, context, history)).toEqual(new Set(['writer']));
      expect(yield* loadedAgentSkillIds(skills, { revision: 'changed' }, history)).toEqual(new Set());
      const locked = yield* policy.evaluate({
        ...context,
        hook: 'beforeStep',
        runId: 'run-1',
        run,
        modelMessages: [Message.user('Write an artifact.')],
        invocationKey: 'step:0',
        ordinal: 1,
      });
      const loaded = yield* policy.evaluate({
        ...context,
        hook: 'beforeStep',
        runId: 'run-2',
        run,
        modelMessages: [...history, Message.user('Write another artifact.')],
        invocationKey: 'step:0',
        ordinal: 1,
      });
      expect(agentStepToolPolicy(locked, [LOAD_SKILL_TOOL, 'write_artifact']).activeTools).toEqual([LOAD_SKILL_TOOL]);
      expect(agentStepToolPolicy(loaded, [LOAD_SKILL_TOOL, 'write_artifact']).activeTools).toBeNull();
    }),
  );
  it.effect(
    'a pool that gates no tools answers without reading history',
    Effect.fnUntraced(function* () {
      let read = 0;
      const textOnly = [
        { id: 'prose', description: 'Instructions only.', instructions: () => 'Prose instructions.' },
      ] satisfies AgentSkillPool<SkillContext, 'prose'>;
      const policy = new AgentRuntimePolicy<SkillContext>([agentSkillRule(textOnly)]);
      const messages = new Proxy([Message.user('Do the work.')] as Message[], {
        get(target, key, receiver) {
          if (key !== 'constructor') read += 1;
          return Reflect.get(target, key, receiver);
        },
      });
      const directives = yield* policy.evaluate({
        revision: 'current',
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
  it.effect(
    'rejects invalid pool identities, tool collisions, and empty instruction payloads',
    Effect.fnUntraced(function* () {
      const duplicateIds = [
        { id: 'duplicate', description: 'First.', instructions: () => 'First instructions.' },
        { id: 'duplicate', description: 'Second.', instructions: () => 'Second instructions.' },
      ] satisfies AgentSkillPool<Record<string, never>, 'duplicate'>;
      const duplicateTools = [
        {
          id: 'first',
          description: 'First.',
          instructions: () => 'First instructions.',
          tools: () => ({
            shared_tool: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Shared.',
              parameters: Schema.Struct({}),
            }),
          }),
        },
        {
          id: 'second',
          description: 'Second.',
          instructions: () => 'Second instructions.',
          tools: () => ({
            shared_tool: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Shared.',
              parameters: Schema.Struct({}),
            }),
          }),
        },
      ] satisfies AgentSkillPool<Record<string, never>, 'first' | 'second'>;
      const emptyInstructions = [{ id: 'empty', description: 'Empty.', instructions: () => '   ' }] satisfies AgentSkillPool<
        Record<string, never>,
        'empty'
      >;
      expect(() => agentSkillTools(duplicateIds, {})).toThrow('Duplicate agent skill: duplicate.');
      expect(() => agentSkillTools(duplicateTools, {})).toThrow('Duplicate agent tool: shared_tool.');
      const catalog = agentSkillTools(emptyInstructions, {});
      const loader = toolExecute(catalog[LOAD_SKILL_TOOL]!);
      if (!loader) return yield* Effect.die('Expected an executable skill loader.');
      const refused = yield* Effect.flip(loader({ skill: 'empty' }, { toolCallId: 'load-empty', caller: unthreadedCaller, messages: [] }));
      expect(refused).toMatchObject({ _tag: 'Tool.Failed', reason: 'Agent skill empty has empty instructions.' });
    }),
  );
});
function skillLoadMessages(instructions: string): Message[] {
  return [
    { role: 'assistant', content: [{ type: 'tool-call', id: 'load-writer', name: LOAD_SKILL_TOOL, input: { skill: 'writer' } }] },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          id: 'load-writer',
          name: LOAD_SKILL_TOOL,
          result: { type: 'json', value: { status: 'loaded', skill: 'writer', instructions } },
        },
      ],
    },
  ];
}
describe('loading a skill twice', () => {
  const loaderOf = (ctx: SkillContext) => {
    const loader = toolExecute(agentSkillTools(skills, ctx)[LOAD_SKILL_TOOL]!);
    if (!loader) throw new Error('Expected an executable skill loader.');
    return loader;
  };
  it.effect(
    'a repeat call answers a note instead of renting context for a second body',
    Effect.fnUntraced(function* () {
      const loader = loaderOf({ revision: 'current' });
      const history = skillLoadMessages('Writer instructions current.');
      const repeat = loaded(yield* loader({ skill: 'writer' }, { toolCallId: 'again', caller: unthreadedCaller, messages: history }));
      expect(repeat).toMatchObject({ status: 'already-loaded', skill: 'writer' });
    }),
  );
  it.effect(
    'a payload lost to compaction is delivered again in full',
    Effect.fnUntraced(function* () {
      const loader = loaderOf({ revision: 'current' });
      const reloaded = loaded(
        yield* loader({ skill: 'writer' }, { toolCallId: 'after-compaction', caller: unthreadedCaller, messages: [] }),
      );
      expect(reloaded).toMatchObject({ status: 'loaded', instructions: 'Writer instructions current.' });
    }),
  );
  it.effect(
    'a payload outdated by an edit is delivered again in full',
    Effect.fnUntraced(function* () {
      const loader = loaderOf({ revision: 'edited' });
      const history = skillLoadMessages('Writer instructions current.');
      const reloaded = loaded(
        yield* loader({ skill: 'writer' }, { toolCallId: 'after-edit', caller: unthreadedCaller, messages: history }),
      );
      expect(reloaded).toMatchObject({ status: 'loaded', instructions: 'Writer instructions edited.' });
    }),
  );
  it.effect(
    'named references come back beside the body, again beside an already-loaded note, and an unknown one refuses',
    Effect.fnUntraced(function* () {
      const referenced = [
        {
          id: 'writer',
          description: 'Write a durable artifact.',
          references: [{ name: 'style', description: 'House style', text: () => Effect.succeed('Style reference.') }],
          instructions: () => 'Writer instructions current.',
        },
      ] satisfies AgentSkillPool<SkillContext, 'writer'>;
      const loader = toolExecute(agentSkillTools(referenced, { revision: 'current' })[LOAD_SKILL_TOOL]!)!;
      const call = (messages: Message[]) => ({ toolCallId: 'load', caller: unthreadedCaller, messages });
      expect(loaded(yield* loader({ skill: 'writer', references: ['style'] }, call([])))).toEqual({
        status: 'loaded',
        skill: 'writer',
        instructions: 'Writer instructions current.',
        references: [{ name: 'style', text: 'Style reference.' }],
      });
      expect(
        loaded(yield* loader({ skill: 'writer', references: ['style'] }, call(skillLoadMessages('Writer instructions current.')))),
      ).toMatchObject({ status: 'already-loaded', references: [{ name: 'style', text: 'Style reference.' }] });
      expect(yield* Effect.flip(loader({ skill: 'writer', references: ['tone'] }, call([])))).toMatchObject({ _tag: 'Tool.Failed' });
    }),
  );
  it.effect(
    'an already-loaded note does not read as a payload',
    Effect.fnUntraced(function* () {
      const noteHistory: Message[] = [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              id: 'note',
              name: LOAD_SKILL_TOOL,
              result: { type: 'json', value: { status: 'already-loaded', skill: 'writer', note: 'points elsewhere' } },
            },
          ],
        },
      ];
      expect(yield* loadedAgentSkillIds(skills, { revision: 'current' }, noteHistory)).toEqual(new Set());
    }),
  );
});
