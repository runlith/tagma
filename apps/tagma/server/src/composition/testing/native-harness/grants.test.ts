import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { composeAgent, DECLARATIONS, agentFilesOf, grantedToolNames } from '../../../native-harness/testing/doubles.js';
import { servedCapabilities } from './capabilities.js';
import { AgentRuleRegistry } from '@runlith/agent/AgentRuntimePolicy';
import { NATIVE_AGENT_RULES } from '../../manifest.js';

const ruleRegistry = new AgentRuleRegistry(NATIVE_AGENT_RULES);

const registry: { source: string; tools: Record<string, string> }[] = [
  { source: 'user-question', tools: { ask_user: 'ask' } },
  { source: 'collaboration', tools: { send_message: 'send', spawn_agent: 'spawn', list_agents: 'list' } },
  { source: 'resources', tools: { held_resources: 'held' } },
  { source: 'output', tools: { read_tool_output: 'output' } },
];

const grants = Effect.map(servedCapabilities(), (definitions) => ({
  profileOf: agentFilesOf()(definitions).profileOf,
  namesOf: (id: string, profile?: Parameters<typeof grantedToolNames>[1]) => {
    const declaration = DECLARATIONS().find((entry) => entry.id === id)!;
    const composed = composeAgent(ruleRegistry, declaration, definitions, {} as never, {} as never, {} as never, {} as never, () =>
      Effect.die(new Error('a grant is read before any thread exists')),
    );
    return grantedToolNames(composed.grant, profile ?? null, [{ source: id, tools: { own: 'own' } }, ...registry]);
  },
}));

const STANDARD = ['ask_user', 'held_resources', 'list_agents', 'own', 'read_tool_output', 'send_message', 'spawn_agent'];

it.effect('each built-in agent is offered its own tools and the standard sources', () =>
  Effect.map(grants, ({ namesOf }) => {
    for (const id of ['tagma', 'declared']) expect(namesOf(id).sort()).toEqual(STANDARD);
  }),
);

it.effect('a declared file that names tools keeps the standard set, the tools it names and nothing else', () =>
  Effect.map(grants, ({ namesOf, profileOf }) => {
    const file = {
      id: 'planner',
      description: 'Plans.',
      body: 'Plan.',
      capabilities: ['files', 'peers'],
      tools: ['spawn_agent', 'own'],
    };
    const profile = { id: file.id, overlay: profileOf(file as never) };

    expect(namesOf('declared', profile).sort()).toEqual(['ask_user', 'own', 'read_tool_output', 'send_message', 'spawn_agent']);
  }),
);

it.effect('a declared file that names capabilities and no tools keeps every tool of those capabilities', () =>
  Effect.map(grants, ({ namesOf, profileOf }) => {
    const file = { id: 'reader', description: 'Reads.', body: 'Read.', capabilities: ['files'] };
    const profile = { id: file.id, overlay: profileOf(file as never) };

    expect(namesOf('declared', profile).sort()).toEqual(['ask_user', 'own', 'read_tool_output']);
  }),
);
