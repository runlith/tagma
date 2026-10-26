<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import type { CollectionItem } from '@runlith/primitives/collection.svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { Listing } from './listing.svelte.js';

  let {
    value,
    textValue,
    disabled = false,
    onSelect,
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & CollectionItem = $props();

  const listing = Listing.use();
</script>

<div
  {...rest}
  role="option"
  aria-disabled={disabled ? 'true' : undefined}
  data-disabled={disabled ? 'true' : undefined}
  data-slot="command-item"
  class={cn(
    "group/command-item relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-ui outline-hidden select-none data-highlighted:bg-selected data-highlighted:text-foreground data-highlighted:*:[svg]:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    className,
  )}
  {@attach listing.collection.item(() => ({ value, textValue, disabled, onSelect }))}
  {@attach listing.counted}
>
  {@render children?.()}
  <CheckIcon class="ml-auto size-3.5 opacity-0 group-data-[checked=true]/command-item:opacity-100" />
</div>
