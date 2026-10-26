<script lang="ts">
  import { cn, type WithElementRef } from '$lib/shared/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import DialogClose from './dialog-close.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    showCloseButton = false,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    showCloseButton?: boolean;
  } = $props();
</script>

<div
  bind:this={ref}
  data-slot="dialog-footer"
  class={cn('gap-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
  {...restProps}
>
  {@render children?.()}
  {#if showCloseButton}
    <DialogClose>
      {#snippet child({ props })}
        <Button variant="outline" {...props}>Close</Button>
      {/snippet}
    </DialogClose>
  {/if}
</div>
