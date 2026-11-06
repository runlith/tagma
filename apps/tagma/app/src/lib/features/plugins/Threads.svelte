<script lang="ts">
  import type { ThreadFacts } from '@tagma/server/threads/contract/wire/evidence';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';

  let { threads, total, home }: { threads: readonly ThreadFacts[]; total: number; home: string } = $props();

  const addresses = Addresses.use();
</script>

{#if threads.length > 0}
  <section class="grid gap-2" aria-label="Its threads">
    <h3 class="text-small font-medium text-muted-foreground">Its threads</h3>
    <div class="grid divide-y overflow-hidden rounded-lg border bg-raised">
      {#each threads as one (one.id)}
        <a href={addresses.thread(one.id, home)} class="px-3 py-2 transition-colors hover:bg-hover">
          <FadeText text={one.title === '' ? 'Untitled thread' : one.title} class="text-ui" />
        </a>
      {/each}
    </div>
    {#if total > threads.length}<p class="text-small text-muted-foreground">and {total - threads.length} more</p>{/if}
  </section>
{/if}
