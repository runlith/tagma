<script lang="ts">
  import * as DialogPrimitive from '@runlith/primitives/dialog';
  import DialogOverlay from './dialog-overlay.svelte';
  import type { ComponentProps, Snippet } from 'svelte';
  import { cn } from '$lib/shared/utils.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import XIcon from '@lucide/svelte/icons/x';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    showCloseButton = true,
    ...restProps
  }: ComponentProps<typeof DialogPrimitive.Content> & {
    portalProps?: ComponentProps<typeof DialogPrimitive.Portal>;
    children: Snippet;
    showCloseButton?: boolean;
  } = $props();
</script>

<DialogPrimitive.Portal {...portalProps}>
  <DialogOverlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="dialog-content"
    class={cn(
      'bg-popover text-popover-foreground border grid max-w-[calc(100%-2rem)] gap-6 rounded-lg p-6 text-ui shadow-float sm:max-w-md fixed top-1/2 left-1/2 w-full -translate-x-1/2 -translate-y-1/2 outline-none',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon-sm" {...props} class={cn('absolute top-4 right-4', props.class as string | undefined)}>
            <XIcon class="size-4" />
            <span class="sr-only">Close</span>
          </Button>
        {/snippet}
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPrimitive.Portal>
