// @vitest-environment jsdom
import { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
import { settled } from '@runlith/chat-ui/composer';
import { createEntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
import { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
import { Layer } from '@runlith/layer/Layer';
import { makePoint } from '@runlith/layer/testing';
import { RegistryClash } from '@runlith/roster/RegistryClash';
import { Effect } from 'effect';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import {
  type CommandDeclaration,
  ComposerParts,
  FeedParts,
  ThreadCommands,
  ThreadKinds,
  ThreadTools,
  productKindDeclaration,
} from './contribution.js';
import Contributions from './Contributions.svelte';
import Failing from './Failing.fixture.svelte';
import Probe, { probeEntry, probeKind } from './Probe.fixture.svelte';
import * as probeStatic from './ProbeStatic.fixture.svelte';
import { RenderingPorts } from './RenderingPorts.svelte.js';

let shell: TestApp | undefined;

afterEach(async () => {
  await shell?.unmount();
  shell = undefined;
});

const command = (name: string, message: string): CommandDeclaration => ({
  name,
  make: () => ({ name, run: () => Effect.succeed({ tone: 'success' as const, message }) }),
});

function assemble() {
  const composer = new ComposerContributions();
  const kinds = createEntryKinds();
  const regions = new FeedRegions();
  shell = mountShell(
    Layer.mergeAll(
      ThreadCommands,
      ThreadTools,
      ThreadKinds,
      ComposerParts,
      FeedParts,
      ThreadCommands.contribute('probe', command('probe', 'probed')),
      ThreadTools.contribute('probe', { name: 'probe_static_tool', modelText: () => 'static text' }),
      ThreadKinds.contribute('probe', ...probeStatic.kinds),
      FeedParts.contribute('failing', { id: 'failing.feed', payload: { component: Failing } }),
      FeedParts.contribute('probe', { id: 'probe.feed', payload: { component: Probe } }),
    ),
  );
  shell.draw(Contributions, {
    owners: {},
    surface: {},
    composer,
    kinds,
    regions,
    rendering: new RenderingPorts(),
    transcript: {},
  });
  flushSync();
  return { composer, kinds, regions, app: shell };
}

it.effect(
  'a feature declared only by a layer outside the threads feature contributes a command, an entry kind, tools and a pinned mount where the owner renders them, beside a part that fails alone, and takes them away when it leaves',
  () =>
    Effect.gen(function* () {
      const { composer, kinds, regions, app } = assemble();

      const [probe] = composer.commands;
      expect(probe?.name).toBe('probe');
      expect(yield* settled(probe!.run({ gesture: 'send' }))).toEqual({ tone: 'success', message: 'probed' });
      expect(kinds.renderer(probeEntry('a'))).toBeDefined();
      expect(kinds.keepsAlive(probeEntry('a'))).toBe(true);
      expect(kinds.tool('probe_tool')?.render).toBeDefined();
      expect(kinds.toolModelText('probe_static_tool', {})).toBe('static text');
      expect(regions.pins.map((pin) => pin.id)).toEqual(['probe']);

      const leave = app.get(ThreadCommands).register('late', command('late', 'joined'));
      flushSync();
      expect(composer.commands.map((one) => one.name).sort()).toEqual(['late', 'probe']);
      leave();
      flushSync();
      expect(composer.commands.map((one) => one.name)).toEqual(['probe']);

      yield* Effect.promise(() => app.unmount());
      shell = undefined;
      expect(composer.commands).toEqual([]);
      expect(kinds.renderer(probeEntry('a'))).toBeUndefined();
      expect(kinds.keepsAlive(probeEntry('a'))).toBe(false);
      expect(kinds.tool('probe_tool')).toBeUndefined();
      expect(kinds.tool('probe_static_tool')).toBeUndefined();
      expect(regions.pins).toEqual([]);
    }),
);

test('two features giving one entry kind the same facet refuse the second and name both', () => {
  const kinds = makePoint(ThreadKinds);
  kinds.register('a', productKindDeclaration({ ...probeKind, keepAlive: true }));

  const error = (() => {
    try {
      kinds.register('b', productKindDeclaration({ ...probeKind, keepAlive: true, classify: () => ({}) }));
    } catch (thrown) {
      return thrown;
    }
  })();

  expect(error).toBeInstanceOf(RegistryClash);
  expect((error as RegistryClash).holders).toEqual(['a', 'b']);
  expect(() => kinds.register('c', productKindDeclaration({ ...probeKind, estimate: () => 1 }))).not.toThrow();
});
