<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { RecapReading } from '@tagma/server/threads/contract/wire/recap';
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import BlockRefText from '../BlockRefText.svelte';
  import { recapAge } from './recap.js';

  let { recap, context }: { recap: RecapReading; context: ChatEntryContext } = $props();

  const wallClock = WallClock.use();
  $effect(() => wallClock.watch());

  const id = $derived(`recap:${recap.basis.generatedAt}:${recap.status}`);
  const open = $derived(context.expanded(id, recap.status === 'current'));
  const age = $derived(recapAge(recap.basis.generatedAt, wallClock.minute));
</script>

{#if open}
  <section class="grid w-full min-w-0 gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3" data-recap={recap.status}>
    <button
      type="button"
      class="flex cursor-pointer items-center gap-2 text-left font-mono text-meta"
      aria-expanded="true"
      onclick={() => context.setExpanded(id, false)}
    >
      <span class="font-medium text-primary">↳ Recap</span>
      <span class="text-muted-foreground">{age}</span>
      <ChevronRight class="ml-auto size-3 rotate-90 text-muted-foreground/70" />
    </button>
    <p class="text-body leading-relaxed whitespace-pre-line"><BlockRefText text={recap.summary} /></p>
    {#if recap.next !== null}
      <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-ui leading-relaxed">
        <span class="pt-0.5 font-mono text-meta text-muted-foreground">Next</span>
        <span><BlockRefText text={recap.next} /></span>
      </div>
    {/if}
  </section>
{:else}
  <button
    type="button"
    class="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-left text-small text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
    aria-expanded="false"
    data-recap={recap.status}
    onclick={() => context.setExpanded(id, true)}
  >
    <span class="shrink-0 font-mono text-meta font-medium">↳ Recap</span>
    <span class="min-w-0 flex-1 truncate text-ui"><BlockRefText text={recap.summary} plain /></span>
    <span class="shrink-0 font-mono text-meta">{age}</span>
  </button>
{/if}
