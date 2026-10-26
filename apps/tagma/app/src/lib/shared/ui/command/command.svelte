<script lang="ts">
  import { untrack } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { Listing } from './listing.svelte.js';

  let { value = $bindable(), class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { value?: string } = $props();

  const id = $props.id();
  const listing = Listing.make(id);
  const { collection } = listing;

  let seen = false;
  let asked = untrack(() => listing.query);

  $effect(() => {
    const count = listing.count;
    const wanted = value;
    untrack(() => {
      const target = (wanted === undefined ? undefined : collection.find(wanted)) ?? collection.highlighted ?? collection.first();
      if (target !== collection.highlighted) collection.highlight(target);
      if (count > 0 && collection.value !== wanted) value = collection.value;
    });
  });

  $effect(() => {
    const query = listing.query;
    untrack(() => {
      if (query === asked) return;
      asked = query;
      const first = collection.first();
      if (first !== undefined) collection.highlight(first);
    });
  });

  $effect(() => {
    const highlighted = collection.value;
    if (listing.count > 0) seen = true;
    if (seen) value = highlighted;
  });
</script>

<div
  {...rest}
  data-slot="command"
  class={cn('flex size-full flex-col overflow-hidden rounded-lg! bg-popover p-1 text-popover-foreground', className)}
>
  {@render children?.()}
</div>
