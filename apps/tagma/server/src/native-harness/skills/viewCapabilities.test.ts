import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { AgentSkill } from '@runlith/agent/AgentSkill';
import { Effect } from 'effect';
import { capability, TAGMA_VIEW } from '../../views/contract/wire/capabilities.js';
import { withViewCapabilities } from './viewCapabilities.js';

const plugins: AgentSkill<unknown> = {
  id: 'plugins',
  description: 'Plugins.',
  references: [{ name: 'example', description: 'A plugin' }],
  instructions: () => 'Before.\n<!-- view-capabilities -->\nAfter.',
  reference: (name) => Effect.succeed(`disk ${name}`),
};

const other: AgentSkill<unknown> = { id: 'other', description: 'Other.', instructions: () => '<!-- view-capabilities -->' };

const echo = capability({
  id: 'echo',
  signature: '(said)',
  description: 'Says it back.',
  reference: { title: 'Echo in a view', text: 'Echo details.' },
});

it.effect('the plugins skill lists every member the root composed, and reads its references beside its own', () =>
  Effect.gen(function* () {
    const [skill] = withViewCapabilities([plugins], [...TAGMA_VIEW, echo]);
    const text = skill!.instructions(undefined) as string;
    expect(text).toContain('- `open({threadId, beside?} | {section} | {pane})` — Opens a thread');
    expect(text).toContain('- `echo(said)` — Says it back. Reference: `echo`.');
    expect(text.endsWith('\nAfter.')).toBe(true);
    expect(skill!.references?.at(-1)).toEqual({ name: 'echo', description: 'Echo in a view' });
    expect(yield* skill!.reference!('echo')).toBe('# Echo in a view\n\nEcho details.');
    expect(yield* skill!.reference!('example')).toBe('disk example');
    expect(withViewCapabilities([plugins], TAGMA_VIEW)[0]!.instructions(undefined)).not.toContain('echo');
    expect(withViewCapabilities([other], TAGMA_VIEW)[0]).toBe(other);
  }),
);
