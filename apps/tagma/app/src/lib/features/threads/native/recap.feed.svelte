<script lang="ts">
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import type { FeedRegions } from '@runlith/chat-ui/FeedRegions.svelte';
  import type { ShownThread } from '../ShownThread.js';
  import { ThreadRecap } from '../thread/ThreadRecap.svelte.js';
  import RecapAttemptCard from './RecapAttemptCard.svelte';
  import RecapCard from './RecapCard.svelte';

  let { shown, regions, contributor }: { shown: ShownThread; regions: FeedRegions; contributor: string } = $props();

  const recap = $derived(shown.lease?.get(ThreadRecap).recap ?? null);
  const attempt = $derived(shown.lease?.get(ThreadRecap).attempt ?? null);

  $effect.pre(() => {
    const disposers = [
      regions.interlude(contributor, { id: 'recap', after: () => recap?.basis.entryId ?? null, body: recapCard }),
      regions.interlude(contributor, { id: 'recap-attempt', after: () => attempt?.entryId ?? null, body: attemptCard }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

{#snippet recapCard(view: ChatEntryContext)}
  {#if recap}
    <RecapCard {recap} context={view} />
  {/if}
{/snippet}

{#snippet attemptCard(_view: ChatEntryContext)}
  {#if attempt}
    <RecapAttemptCard {attempt} />
  {/if}
{/snippet}
