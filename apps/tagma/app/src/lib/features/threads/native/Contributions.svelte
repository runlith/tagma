<script lang="ts">
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import PointView from '@runlith/layer/svelte/PointView.svelte';
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

  $effect.pre(() => {
    const disposers = [
      ...commands.items.map((one) => composer.command(one.name, one.make(owners))),
      ...tools.items.map((one) => kinds.registerTool(one.name, one)),
      ...declarations.items.map((one) => one.register(kinds, one.key)),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

<PointView
  point={composerParts}
  propsOf={(one: ComposerPartDeclaration): ComposerPart => ({ ...owners, contributor: one.id, composer, surface, rendering })}
/>
<PointView
  point={feedParts}
  propsOf={(one: FeedPartDeclaration): FeedPart => ({ ...owners, contributor: one.id, kinds, regions, transcript })}
/>
