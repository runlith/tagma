<script lang="ts">
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import type { SlotSurface } from './contribution.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';
  import TeamChip from './TeamChip.svelte';

  let {
    views,
    writes,
    composer,
    surface,
    contributor,
  }: { views: ThreadViews; writes: ThreadWrites; composer: ComposerContributions; surface: SlotSurface; contributor: string } = $props();

  $effect.pre(() => (surface.lead ? undefined : composer.chip(contributor, { id: 'team', region: 'leading', order: 1, body: team })));
</script>

{#snippet team()}
  <TeamChip {views} {writes} />
{/snippet}
