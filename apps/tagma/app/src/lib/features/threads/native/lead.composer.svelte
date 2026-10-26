<script lang="ts">
  import type { SlotSurface } from './contribution.js';
  import type { ComposerContributions } from '@runlith/chat-ui/ComposerContributions.svelte';

  let { composer, surface, contributor }: { composer: ComposerContributions; surface: SlotSurface; contributor: string } = $props();

  $effect.pre(() =>
    surface.lead ? composer.chip(contributor, { id: 'lead', region: 'leading', order: 1, body: surface.lead }) : undefined,
  );
</script>
