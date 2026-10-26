// @vitest-environment jsdom
import { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
import { settled } from '@runlith/chat-ui/composer';
import { createEntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
import { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
import { RegistryClash } from '@runlith/chat-ui/RegistryClash';
import { Effect } from 'effect';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { DeclarationMissing, declare, type DeclarationSources } from './contribution.js';
import Contributions from './Contributions.svelte';
import Probe, { probeEntry } from './Probe.fixture.svelte';
import * as probeStatic from './ProbeStatic.fixture.svelte';
import { RenderingPorts } from './RenderingPorts.svelte.js';
import { collectRecords } from './records.js';

const mounted: Array<ReturnType<typeof mount>> = [];

afterEach(() => {
  for (const one of mounted.splice(0)) unmount(one);
});

const probeCommand = {
  name: 'probe',
  make: () => ({ name: 'probe', run: () => Effect.succeed({ tone: 'success' as const, message: 'probed' }) }),
};

const sources = (over: Partial<DeclarationSources> = {}): DeclarationSources => ({
  commands: { 'features/probe/probe.commands.ts': { commands: [probeCommand] } },
  tools: { 'features/probe/probe.tools.ts': { tools: [{ name: 'probe_static_tool', modelText: () => 'static text' }] } },
  kinds: { 'features/probe/probe.kinds.svelte': probeStatic },
  composer: {},
  feed: { 'features/probe/probe.feed.svelte': { default: Probe } },
  ...over,
});

function assemble(over: Partial<DeclarationSources> = {}) {
  const composer = new ComposerContributions();
  const kinds = createEntryKinds();
  const regions = new FeedRegions();
  const props = {
    owners: {} as never,
    surface: {} as never,
    composer,
    kinds,
    regions,
    rendering: new RenderingPorts(),
    transcript: {} as never,
    declared: declare(sources(over)),
  };
  const open = () => {
    const one = mount(Contributions, { target: document.body, props });
    mounted.push(one);
    flushSync();
    return one;
  };
  return { composer, kinds, regions, open };
}

it.effect(
  'a feature declared only by its own files contributes a command, an entry kind, tools and a pinned mount, and takes them away when it leaves',
  () =>
    Effect.gen(function* () {
      const { composer, kinds, regions, open } = assemble();
      const one = open();

      const [command] = composer.commands;
      expect(command?.name).toBe('probe');
      expect(yield* settled(command!.run({ gesture: 'send' }))).toEqual({ tone: 'success', message: 'probed' });
      expect(kinds.renderer(probeEntry('a'))).toBeDefined();
      expect(kinds.keepsAlive(probeEntry('a'))).toBe(true);
      expect(kinds.tool('probe_tool')?.render).toBeDefined();
      expect(kinds.toolModelText('probe_static_tool', {})).toBe('static text');
      expect(regions.pins.map((pin) => pin.id)).toEqual(['probe']);

      mounted.splice(mounted.indexOf(one), 1);
      unmount(one);
      flushSync();
      expect(composer.commands).toEqual([]);
      expect(kinds.renderer(probeEntry('a'))).toBeUndefined();
      expect(kinds.keepsAlive(probeEntry('a'))).toBe(false);
      expect(kinds.tool('probe_tool')).toBeUndefined();
      expect(kinds.tool('probe_static_tool')).toBeUndefined();
      expect(regions.pins).toEqual([]);
    }),
);

test('two declarations of one command refuse the collection at load and name both files', () => {
  const error = (() => {
    try {
      declare(
        sources({
          commands: {
            'features/a/probe.commands.ts': { commands: [probeCommand] },
            'features/b/probe.commands.ts': { commands: [probeCommand] },
          },
        }),
      );
    } catch (thrown) {
      return thrown;
    }
  })();

  expect(error).toBeInstanceOf(RegistryClash);
  expect((error as RegistryClash).holders).toEqual(['features/a/probe.commands.ts', 'features/b/probe.commands.ts']);
  expect((error as RegistryClash).message).toMatch(/features\/a\/probe.*features\/b\/probe/);
});

test('two feed parts contributing the same entry kind facet refuse the assembly and name both files', () => {
  const { open } = assemble({
    feed: { 'features/a/probe.feed.svelte': { default: Probe }, 'features/b/probe.feed.svelte': { default: Probe } },
  });

  const error = (() => {
    try {
      open();
    } catch (thrown) {
      return thrown;
    }
  })();

  expect(error).toBeInstanceOf(RegistryClash);
  expect((error as RegistryClash).holders).toEqual(['features/a/probe.feed.svelte', 'features/b/probe.feed.svelte']);
});

test('a declaring file without its list or its component is a typed error naming the file', () => {
  expect(() => declare(sources({ commands: { 'features/x/x.commands.ts': {} } }))).toThrow(DeclarationMissing);
  expect(() => declare(sources({ feed: { 'features/x/x.feed.svelte': {} } }))).toThrow(/features\/x\/x\.feed\.svelte/);
});

test('two declarations of one product record refuse the collection and name both files', () => {
  const record = { id: 'probe', project: () => null };
  expect(() =>
    collectRecords({
      'features/a/productRecords.ts': { productRecords: [record] },
      'features/b/productRecords.ts': { productRecords: [record] },
    }),
  ).toThrow(/features\/a\/productRecords.*features\/b\/productRecords/);
});
