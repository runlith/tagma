<script lang="ts">
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import type { ShownThread } from '../ShownThread.js';
  import { ModelDefaults } from '../ModelDefaults.svelte.js';
  import ConnectCard from './ConnectCard.svelte';
  import type { ThreadBirth } from './ThreadBirth.svelte.js';

  let { shown, birth, regions, contributor }: { shown: ShownThread; birth: ThreadBirth; regions: FeedRegions; contributor: string } =
    $props();

  const defaults = ModelDefaults.use();

  const showing = $derived(shown.id === null && (defaults.unconnected || (!defaults.known && birth.settings.connecting)));

  $effect.pre(() => {
    if (!showing) return;
    return regions.hero(contributor, { id: 'connect-model', body: card });
  });
</script>

{#snippet card()}
  <ConnectCard projectId={shown.projectId} />
{/snippet}
