<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { Listing } from './listing.svelte.js';

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();

  const listing = Listing.use();
  const field = $derived(listing.inputs === 0);
</script>

<div
  {...rest}
  id={listing.id}
  role="listbox"
  tabindex={field ? 0 : undefined}
  data-slot="command-list"
  class={cn('no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none', className)}
  {@attach field ? listing.collection.field : undefined}
>
  {@render children?.()}
</div>
