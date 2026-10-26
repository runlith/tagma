<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import { Select } from '@runlith/primitives/select.svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let { class: className, children, ...rest }: HTMLButtonAttributes = $props();

  const select = Select.use();
</script>

<button
  type="button"
  {...rest}
  data-slot="select-trigger"
  aria-haspopup="listbox"
  aria-expanded={select.open}
  aria-controls={select.open ? select.id : undefined}
  data-state={select.open ? 'open' : 'closed'}
  disabled={select.disabled}
  class={cn(
    "flex h-7 w-fit items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-input bg-transparent py-1 pr-1.5 pl-2 text-ui outline-none transition-[color,border-color] focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    className,
  )}
  {@attach select.trigger}
>
  {@render children?.()}
  <ChevronDownIcon class="pointer-events-none size-3.5 text-muted-foreground" />
</button>
