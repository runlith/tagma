<script lang="ts">
  import { match, pieces } from '@runlith/search-text/match';

  let {
    text,
    query = '',
    prose = false,
    positions,
    from = 0,
    to,
  }: { text: string; query?: string; prose?: boolean; positions?: readonly number[]; from?: number; to?: number } = $props();

  const parts = $derived(pieces(text, positions ?? match(query, { name: text, prose })?.positions ?? [], from, to ?? text.length));
</script>

{#each parts as part, index (index)}{#if part.hit}<span class="text-foreground underline underline-offset-2">{part.text}</span
    >{:else}{part.text}{/if}{/each}
