<script lang="ts">
  import type { CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { lineCount } from './lineCount.js';

  let { lines, class: extra, ...rest }: { lines: CheckoutLines; class?: string } & HTMLAttributes<HTMLSpanElement> = $props();

  const said = $derived(lineCount(lines));
</script>

{#if said?.kind === 'binary'}
  <span class={cn('font-mono text-meta text-muted-foreground/60', extra)} {...rest}>binary</span>
{:else if said?.kind === 'lines'}
  <span class={cn('flex gap-1.5 font-mono text-meta tabular-nums', extra)} {...rest}>
    {#if said.added !== null}<span class="text-chat-diff-added/85">{said.added}</span>{/if}
    {#if said.removed !== null}<span class="text-chat-diff-removed/85">{said.removed}</span>{/if}
  </span>
{/if}
