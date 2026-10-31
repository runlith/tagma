import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { AgentRuleRegistry, AgentRuntimePolicy, agentRule, orderedRules } from '@runlith/agent/AgentRuntimePolicy';
import { AgentRunState } from '@runlith/agent/AgentRunState';
import { CAPABILITIES, NATIVE_AGENT_RULES } from '../composed.js';
import { capabilityDefinitionsOf, DECLARATIONS } from '../../../native-harness/testing/doubles.js';
import type { RuleSetup } from '../../../native-harness/contract/service/rules.js';
import { ThreadMandate } from '../../../threads/contract/service/mandate.js';
import { ThreadTeams } from '../../../threads/contract/service/team.js';

const unused = () => Effect.die('Rule ordering does not invoke an owner operation.');
const mandate = ThreadMandate.of({
  delegationLineage: unused,
  setDelegation: unused,
  approvesLineage: unused,
  setApproves: unused,
  teamLineage: unused,
  setTeam: unused,
  takenOver: unused,
  setTakenOver: unused,
  operatorNotice: unused,
  setOperatorNotice: unused,
});
const teams = ThreadTeams.of({ layers: unused, of: unused, set: unused, promote: unused, adopt: unused });
const capabilities: Readonly<Record<string, readonly string[]>> = {
  tagma: ['mcp', 'skills'],
  rules: ['skills'],
  declared: ['mcp', 'skills'],
  harness: [],
};
const common: [string, string, string, boolean][] = [
  ['project-instructions', 'graph', 'beforeStep', true],
  ['touch', 'graph', 'afterTool', false],
  ['explicit-skills', 'skills', 'beforeStep', true],
  ['capability-cues', 'native-harness', 'afterTool', false],
  ['delegation', 'threads', 'beforeStep', false],
  ['capability-settings', 'native-harness', 'beforeStep', false],
  ['team', 'threads', 'beforeStep', false],
  ['rule-checks', 'enforcement', 'afterTool', false],
];

it.effect('every built-in declaration keeps its rule set and hook order when module registration order changes', () =>
  Effect.gen(function* () {
    const definitions = yield* capabilityDefinitionsOf(CAPABILITIES);
    const registry = new AgentRuleRegistry([...NATIVE_AGENT_RULES].reverse());
    for (const declaration of DECLARATIONS()) {
      const setup: RuleSetup = { declaration, definitions, mandate, teams };
      const registered = registry.rules(setup);
      expect(registered.map((rule) => [rule.id, rule.owner, rule.hook, rule.critical === true])).toEqual(common);
      const rules = orderedRules([...registered, ...definitions.rules(declaration, (ctx) => ctx.thread.profile?.overlay)]);
      const tail = capabilities[declaration.id]!;
      expect(rules.map((rule) => rule.id)).toEqual([...common.map((row) => row[0]), ...tail]);
      const called: string[] = [];
      const policy = new AgentRuntimePolicy(
        rules.map((rule) =>
          agentRule<unknown>(
            rule.id,
            () => {
              called.push(rule.id);
              return null;
            },
            rule,
          ),
        ),
      );
      const facts = { runId: 'run', run: new AgentRunState(), invocationKey: 'probe', ordinal: 1, modelMessages: [] };
      yield* policy.evaluate({ ...facts, hook: 'beforeStep' });
      expect(called.splice(0)).toEqual(['project-instructions', 'explicit-skills', 'delegation', 'capability-settings', 'team', ...tail]);
      yield* policy.evaluate({ ...facts, hook: 'afterTool' });
      expect(called.splice(0)).toEqual(['touch', 'capability-cues', 'rule-checks', ...tail]);
      yield* policy.evaluate({ ...facts, hook: 'beforeTool' });
      expect(called).toEqual([...tail]);
    }
  }),
);
