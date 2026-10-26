<script lang="ts">
  import { cn } from './utils.js';
  import { codeParts } from './codeParts.js';

  let { text, codeClass = 'rounded-sm bg-selected px-1' }: { text: string; codeClass?: string } = $props();

  const parts = $derived(codeParts(text));
</script>

{#each parts as part, index (index)}{#if part.code}<code class={cn('font-mono', codeClass)}>{part.text}</code>{:else}{part.text}{/if}{/each}
