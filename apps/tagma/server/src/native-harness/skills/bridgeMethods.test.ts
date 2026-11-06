import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { AgentSkill } from '@runlith/agent/AgentSkill';
import { Effect } from 'effect';
import { bridgeMethod, HOST_BRIDGE } from '../../views/contract/wire/bridge.js';
import { withBridgeMethods } from './bridgeMethods.js';

const plugins: AgentSkill<unknown> = {
  id: 'plugins',
  description: 'Plugins.',
  references: [{ name: 'example', description: 'A plugin' }],
  instructions: () => 'Before.\n<!-- bridge-methods -->\nAfter.',
  reference: (name) => Effect.succeed(`disk ${name}`),
};

const other: AgentSkill<unknown> = { id: 'other', description: 'Other.', instructions: () => '<!-- bridge-methods -->' };

const echo = bridgeMethod({
  id: 'echo',
  notifications: ['tagma/notifications/echo'],
  signature: '{said}',
  description: 'Says it back.',
  reference: { title: 'Echo in a view', text: 'Echo details.' },
});

it.effect('the plugins skill lists every declared method with its signature, notifications and reference', () =>
  Effect.gen(function* () {
    const [skill] = withBridgeMethods([plugins], [...HOST_BRIDGE, echo]);
    const text = skill!.instructions(undefined) as string;
    expect(text).toContain('- `tagma/open {threadId, beside?} | {section: <view>} | {pane: <view>}`');
    expect(text).toContain('Notifies `tagma/notifications/thread`.');
    expect(text).toContain('- `tagma/echo {said}` — Says it back. Notifies `tagma/notifications/echo`. Reference: `echo`.');
    expect(text.startsWith('Before.\n- `tagma/open')).toBe(true);
    expect(text.endsWith('\nAfter.')).toBe(true);
  }),
);

it.effect('a root without a method does not mention it, and the skill reads declared references beside its own', () =>
  Effect.gen(function* () {
    const bare = withBridgeMethods([plugins], HOST_BRIDGE)[0]!;
    expect(bare.instructions(undefined)).not.toContain('tagma/echo');
    expect(bare.references?.map(({ name }) => name)).toEqual(['example']);

    const composed = withBridgeMethods([plugins], [...HOST_BRIDGE, echo])[0]!;
    expect(composed.references).toEqual([
      { name: 'example', description: 'A plugin' },
      { name: 'echo', description: 'Echo in a view' },
    ]);
    expect(yield* composed.reference!('echo')).toBe('# Echo in a view\n\nEcho details.');
    expect(yield* composed.reference!('example')).toBe('disk example');
  }),
);

it.effect('only the plugins skill is rendered', () =>
  Effect.sync(() => {
    expect(withBridgeMethods([other], HOST_BRIDGE)[0]).toBe(other);
  }),
);
