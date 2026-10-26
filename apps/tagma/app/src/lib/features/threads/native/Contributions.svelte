<script lang="ts">
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import type { Declarations, SlotOwners, SlotSurface } from './contribution.js';
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
    declared,
  }: {
    owners: SlotOwners;
    surface: SlotSurface;
    composer: ComposerContributions;
    kinds: EntryKinds;
    regions: FeedRegions;
    rendering: RenderingPorts;
    transcript: TranscriptReading;
    declared: Declarations;
  } = $props();

  $effect.pre(() => {
    const disposers = [
      ...declared.commands.map((one) => composer.command(one.contributor, one.item.make(owners))),
      ...declared.tools.map((one) => kinds.registerTool(one.contributor, one.item)),
      ...declared.kinds.map((one) => one.item.register(kinds, one.contributor)),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

{#each declared.composer as part (part.contributor)}
  <part.item {...owners} contributor={part.contributor} {composer} {surface} {rendering} />
{/each}
{#each declared.feed as part (part.contributor)}
  <part.item {...owners} contributor={part.contributor} {kinds} {regions} {transcript} />
{/each}
