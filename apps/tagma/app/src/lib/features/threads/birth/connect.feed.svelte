<script lang="ts">
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import type { ShownThread } from '../ShownThread.js';
  import { ModelDefaults } from '../ModelDefaults.svelte.js';
  import ConnectCard from './ConnectCard.svelte';

  let { shown, regions, contributor }: { shown: ShownThread; regions: FeedRegions; contributor: string } = $props();

  const defaults = ModelDefaults.use();

  const showing = $derived(shown.id === null && defaults.unconnected);

  $effect.pre(() => {
    if (!showing) return;
    return regions.hero(contributor, { id: 'connect-model', body: card });
  });
</script>

{#snippet card()}
  <ConnectCard projectId={shown.projectId} />
{/snippet}
