import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { agentRule, type AgentRule } from '../../agent/policy/AgentRuntimePolicy';
import { AgentRunState } from '../../agent/AgentRunState';
import { Agent } from '../../agent/Agent';
import { AgentDefinitions, type AgentCapability, capabilityHolds } from './AgentDefinitions';
import type { AgentProfile } from './AgentProfile';
type Ctx = object;
const guide = (id: string, text: string): AgentRule<Ctx> => agentRule<Ctx>(id, () => ({ type: 'guide', text }), { owner: 'test' });
const capability = (id: string, text: string): AgentCapability<Ctx> => ({ id, description: id, rules: [guide(id, text)] });
const declared = { id: 'agent', identity: 'You are the agent.', capabilities: ['notes'], sources: [] };
const evaluate = (rules: readonly AgentRule<Ctx>[]) =>
  Effect.forEach(rules, (rule) =>
    rule({
      hook: 'beforeStep',
      modelMessages: [],
      runId: 'run-1',
      run: new AgentRunState(),
      chance: () => false,
      everyNth: () => false,
      cooldown: () => false,
    }),
  );
describe('a capability withdrawn from the owner', () => {
  it.effect(
    'leaves the effective definition and stops its composed rules; a successor gets new rules',
    Effect.fnUntraced(function* () {
      const definitions = new AgentDefinitions<Ctx, AgentCapability<Ctx>>();
      const withdraw = yield* definitions.register('owner', capability('notes', 'first'));
      const composed = definitions.rules(declared, () => undefined);
      expect(definitions.effective(declared).held.map((held) => held.id)).toEqual(['notes']);
      expect(yield* evaluate(composed)).toEqual([{ type: 'guide', text: 'first' }]);
      withdraw();
      expect(definitions.effective(declared).held).toEqual([]);
      expect(yield* evaluate(composed)).toEqual([null]);
      yield* definitions.register('successor', capability('notes', 'second'));
      expect(yield* evaluate(composed)).toEqual([null]);
      expect(yield* evaluate(definitions.rules(declared, () => undefined))).toEqual([{ type: 'guide', text: 'second' }]);
    }),
  );
  it.effect(
    'a capability registered after composition reaches the agent’s grant and rules',
    Effect.fnUntraced(function* () {
      const definitions = new AgentDefinitions<Ctx, AgentCapability<Ctx>>();
      const overlayOf = () => undefined;
      const agent = new Agent<Ctx>({
        id: 'agent',
        name: 'Agent',
        description: 'Composed before its capability.',
        instructions: () => 'Answer.',
        tools: () => ({}),
        standing: () => ({ ...definitions.effective(declared), rules: definitions.rules(declared, overlayOf) }),
        stopWhen: [],
      });
      expect(agent.rules).toEqual([]);
      yield* definitions.register('late', { ...capability('notes', 'late'), source: { id: 'notes' } });
      expect(agent.grant.sources.map((source) => source.source)).toContain('notes');
      expect(yield* evaluate(agent.rules)).toEqual([{ type: 'guide', text: 'late' }]);
    }),
  );
  it.effect(
    'an explicit capability reaches an agent only through an overlay that names it',
    Effect.fnUntraced(function* () {
      const definitions = new AgentDefinitions<Ctx, AgentCapability<Ctx>>();
      yield* definitions.register('owner', capability('notes', 'notes'));
      yield* definitions.register('owner', { ...capability('plugin:poker', 'own'), source: { id: 'plugin:poker' }, explicit: true });
      const every = { ...declared, capabilities: 'every' as const };
      const explicit = definitions.find('plugin:poker')!;
      expect(definitions.effective(every).held.map((held) => held.id)).toEqual(['notes']);
      expect(capabilityHolds(undefined, explicit)).toBe(false);
      const named: AgentProfile = { id: 'poker.player', baseAgentId: 'agent', description: '', capabilities: ['plugin:poker'] };
      expect(definitions.effective(every, named).held.map((held) => held.id)).toEqual(['plugin:poker']);
      expect(capabilityHolds(named, explicit)).toBe(true);
      const extended: AgentProfile = { id: 'poker.dealer', baseAgentId: 'agent', description: '', capabilities: ['notes', 'plugin:poker'] };
      expect(definitions.effective(declared, extended).held.map((held) => held.id)).toEqual(['notes', 'plugin:poker']);
      const naming = { ...declared, capabilities: ['notes', 'plugin:poker'] };
      expect(definitions.effective(naming).held.map((held) => held.id)).toEqual(['notes']);
      expect(definitions.effective(naming, named).held.map((held) => held.id)).toEqual(['plugin:poker']);
    }),
  );
  it.effect(
    'a joining capability is held without being named, only by the agent it joins',
    Effect.fnUntraced(function* () {
      const definitions = new AgentDefinitions<Ctx, AgentCapability<Ctx>>();
      yield* definitions.register('owner', capability('notes', 'first'));
      expect(definitions.effective(declared).held.map((held) => held.id)).toEqual(['notes']);
      yield* definitions.register('module', { ...capability('friction', 'joined'), joins: ['agent'] });
      expect(definitions.effective(declared).held.map((held) => held.id)).toEqual(['notes', 'friction']);
      expect(definitions.effective({ ...declared, id: 'other' }).held.map((held) => held.id)).toEqual(['notes']);
    }),
  );
  it.effect(
    'a second contributor of the same id is refused naming both',
    Effect.fnUntraced(function* () {
      const definitions = new AgentDefinitions<Ctx, AgentCapability<Ctx>>();
      yield* definitions.register('owner', capability('notes', 'first'));
      expect(yield* Effect.flip(definitions.register('rival', capability('notes', 'second')))).toMatchObject({
        _tag: 'RegistryCollision',
        id: 'notes',
        holder: 'owner',
        claimant: 'rival',
      });
    }),
  );
});
