import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';
import { graphFixture } from '../graphFixture.js';
import { availabilityRule, capabilitySettings } from '../../../native-harness/testing/doubles.js';
import type { RuleSetup } from '../../../native-harness/contract/service/rules.js';
import { navigationEnabled } from '../../../navigation/contract/wire/settings.js';
import { signedBy } from '../../../invocation/testing/call.js';

type Gated = Parameters<typeof capabilitySettings>[0][number];
type Reading = Parameters<typeof capabilitySettings>[1];
type Step = Parameters<ReturnType<typeof availabilityRule>>[0];

const gated: Gated = { id: 'navigation', description: 'Code navigation', sections: [], enabledBy: navigationEnabled };

it.live('a capability switch notice names who switched it: the operator or another thread', () =>
  Effect.gen(function* () {
    const lifetime = graphFixture();
    const demo = yield* Effect.map(
      Effect.acquireRelease(lifetime.openEffect(), () => Effect.orDie(lifetime.releaseEffect)),
      (opened) => opened.effects,
    );
    const settings = demo.graph.settings;
    const rule = availabilityRule({
      declaration: { id: 'fixture-agent' },
      definitions: { effective: () => ({ held: [gated] }) },
    } as unknown as RuleSetup);
    const standing = {
      thread: { id: 'reading-thread', profile: null },
      projectId: demo.projectId,
      settings,
      world: { facts: {} },
      comments: () => 'allow',
      images: false,
      offers: { offers: () => [{ id: 'definition' }] },
    };
    const gates = yield* capabilitySettings([gated], standing as unknown as Reading);
    const history: Message[] = [];
    const step = (messages: readonly Message[]) =>
      rule({
        ...standing,
        hook: 'beforeStep',
        modelMessages: messages,
        capabilitySettings: gates,
      } as unknown as Step);
    const told = Effect.fnUntraced(function* () {
      const directive = yield* step(history);
      if (directive === null || !('type' in directive) || directive.type !== 'guide')
        return yield* Effect.die('expected a capability line');
      history.push(agentRuntimeGuidanceMessage(directive.text, directive.state));
      return directive.text;
    });
    const switched = (value: boolean) =>
      settings.write({ scope: 'project', projectId: demo.projectId, key: navigationEnabled.id, value }).pipe(Effect.orDie);
    expect(yield* step(history)).toBeNull();
    yield* switched(true);
    expect(yield* told()).toContain('definition are available again: navigation.enabled is on, switched by operator.');
    yield* signedBy({ harness: 'tagma', key: 'switching-thread' })(switched(false));
    expect(yield* told()).toContain('definition are no longer offered: navigation.enabled is off, switched by [[switching-thread]].');
  }),
);
