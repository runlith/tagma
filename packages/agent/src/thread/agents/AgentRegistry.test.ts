import { describe, expect } from 'bun:test';
import { it, layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { makeAgentRegistry } from './AgentRegistry';
import { registeredAgents } from '../conformance/agents';
import { ThreadTypes } from '../../collaboration/types';
import { agentTypes } from '../../collaboration/native/types';
import { NATIVE_CAPABILITIES, type ThreadRecord } from '../record';
import type { ThreadAgent } from './ThreadAgent';
function probeAgent(id = 'probe'): ThreadAgent {
  const unused = () => Effect.die('No agent operation is driven by the registry.');
  return {
    id,
    name: id,
    description: 'A registered agent.',
    runPolicy: { userStartable: true, backgroundStartable: false },
    grant: { sources: [{ source: id }] },
    prepare: unused,
    instructions: unused,
    toolCatalog: unused,
    toolDoor: unused,
  };
}
describe('AgentRegistry', () => {
  it.effect(
    'gets the registered agent and answers a typed absence after disposal',
    Effect.fnUntraced(function* () {
      const registry = yield* makeAgentRegistry();
      const agent = probeAgent();
      const dispose = yield* registry.register(agent, 'host');
      expect(yield* registry.get('probe')).toBe(agent);
      dispose();
      expect(yield* Effect.flip(registry.get('probe'))).toMatchObject({
        _tag: 'ThreadCallBroke',
        cause: { _tag: 'RegistryAbsent', id: 'probe' },
      });
    }),
  );
  it.effect(
    'a second registration of one id is refused naming both contributors',
    Effect.fnUntraced(function* () {
      const registry = yield* makeAgentRegistry();
      yield* registry.register(probeAgent(), 'host');
      expect(yield* Effect.flip(registry.register(probeAgent(), 'plugin'))).toMatchObject({
        _tag: 'RegistryCollision',
        id: 'probe',
        holder: 'host',
        claimant: 'plugin',
      });
    }),
  );
});
const under: ThreadRecord = {
  id: 'parent',
  principal: 'owner',
  agentId: 'probe',
  typeId: 'probe',
  name: null,
  spawnRootId: 'parent',
  parentThreadId: null,
  spawnedByRunId: null,
  bornOf: null,
  createdBy: null,
  harness: 'native',
  host: null,
  authority: { mode: 'trust', bypassFrom: null },
  plain: false,
  budgetTokens: null,
  capabilities: NATIVE_CAPABILITIES,
  model: { provider: 'openai', model: 'a-model', reasoning: null },
  profile: null,
};
layer(Layer.unwrap(Effect.map(registeredAgents([probeAgent('worker'), probeAgent('source')], 'host'), agentTypes)))('agentTypes', (it) => {
  it.effect(
    'a registered agent resolves on the native harness; an unknown id resolves to nothing',
    Effect.fnUntraced(function* () {
      const catalog = yield* ThreadTypes;
      expect(yield* catalog.resolve({ caller: 'agent', under, typeId: 'worker' })).toEqual({
        baseAgentId: 'worker',
        harness: 'native',
        capabilities: { ...NATIVE_CAPABILITIES, messaging: false },
      });
      expect(yield* catalog.resolve({ caller: 'agent', under, typeId: 'researcher' })).toBeNull();
    }),
  );
  it.effect(
    'the menu contains every registered agent for either caller',
    Effect.fnUntraced(function* () {
      const catalog = yield* ThreadTypes;
      const forAgent = yield* catalog.offered({ caller: 'agent', under });
      expect(forAgent.map((type) => type.id)).toEqual(['worker', 'source']);
      expect(yield* catalog.offered({ caller: 'operator', under })).toEqual(forAgent);
    }),
  );
});
