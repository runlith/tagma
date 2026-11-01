<script lang="ts">
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import PointView from '@runlith/layer/svelte/PointView.svelte';
  import { Access, gateOf } from '$lib/wire/access.js';
  import {
    type ComposerPart,
    type ComposerPartDeclaration,
    ComposerParts,
    type FeedPart,
    type FeedPartDeclaration,
    FeedParts,
    type SlotOwners,
    type SlotSurface,
    ThreadCommands,
    ThreadKinds,
    ThreadTools,
  } from './contribution.js';
  import type { RenderingPorts } from './RenderingPorts.svelte.js';
  import type { TranscriptReading } from './TranscriptReading.svelte.js';

  let {
    owners,
    surface,
    composer,
    kinds,
    regions,
    rendering,
    transcript,
  }: {
    owners: SlotOwners;
    surface: SlotSurface;
    composer: ComposerContributions;
    kinds: EntryKinds;
    regions: FeedRegions;
    rendering: RenderingPorts;
    transcript: TranscriptReading;
  } = $props();

  const commands = ThreadCommands.use();
  const tools = ThreadTools.use();
  const declarations = ThreadKinds.use();
  const composerParts = ComposerParts.use();
  const feedParts = FeedParts.use();
  const access = Access.find();
  const writing = gateOf(access, 'write');
  const reading = gateOf(access, 'read');

  $effect.pre(() => {
    const disposers = [
      ...commands.items.map((one) => composer.command(commands.contributorOf(one) ?? one.name, one.make(owners))),
      ...tools.items.map((one) => kinds.registerTool(tools.contributorOf(one) ?? one.name, one)),
      ...declarations.items.map((one) => one.register(kinds, declarations.contributorOf(one) ?? one.key)),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

<PointView
  point={composerParts}
  gate={writing.shown}
  propsOf={(one: ComposerPartDeclaration): ComposerPart => ({ ...owners, contributor: one.id, composer, surface, rendering })}
/>
<PointView
  point={feedParts}
  gate={reading.shown}
  propsOf={(one: FeedPartDeclaration): FeedPart => ({ ...owners, contributor: one.id, kinds, regions, transcript })}
/>
