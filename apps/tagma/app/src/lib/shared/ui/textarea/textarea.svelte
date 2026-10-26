<script lang="ts">
  import { cn, type WithElementRef, type WithoutChildren } from '$lib/shared/utils.js';
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    'data-slot': dataSlot = 'textarea',
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
  bind:this={ref}
  data-slot={dataSlot}
  class={cn(
    'border-input focus-visible:border-ring aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border bg-sunken px-2 py-1.5 text-ui transition-[color,border-color] placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full outline-none disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  bind:value
  {...restProps}></textarea>
