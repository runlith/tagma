<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { Snippet } from 'svelte';
  import type { HTMLDetailsAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let {
    open = $bindable(false),
    summary,
    children,
    class: className,
    summaryClass,
    ...rest
  }: { open?: boolean; summary: Snippet; children: Snippet; summaryClass?: string } & Omit<
    HTMLDetailsAttributes,
    'open' | 'children'
  > = $props();
</script>

<details {...rest} class={className} bind:open>
  <summary
    class={cn(
      'flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden',
      summaryClass,
    )}
  >
    <ChevronRight class={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
    {@render summary()}
  </summary>
  {@render children()}
</details>
