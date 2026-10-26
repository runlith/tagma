<script lang="ts">
  import Portal from '@runlith/primitives/Portal.svelte';
  import { Popover, type PopoverConduct } from '@runlith/primitives/popover.svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { emerge } from '../emerge.js';

  let {
    class: className,
    style,
    side,
    align = 'center',
    sideOffset = 4,
    alignOffset,
    collisionPadding,
    anchor,
    initialFocus,
    returnFocus,
    dismissOnFocusOutside,
    trapFocus,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & PopoverConduct = $props();

  const popover = Popover.use();
  popover.conduct = () => ({
    side,
    align,
    sideOffset,
    alignOffset,
    collisionPadding,
    anchor,
    initialFocus,
    returnFocus,
    dismissOnFocusOutside,
    trapFocus,
  });

  let present = $state(false);
  $effect.pre(() => {
    if (popover.open) present = true;
  });
</script>

{#if present}
  <Portal>
    {#if popover.open}
      <div
        {...rest}
        id={popover.id}
        role="dialog"
        tabindex="-1"
        data-slot="popover-content"
        data-state={popover.open ? 'open' : 'closed'}
        data-side={popover.float.side}
        data-align={popover.float.align}
        class={cn(
          'flex w-72 origin-(--float-origin) flex-col gap-4 rounded-lg border bg-popover p-4 text-ui text-popover-foreground shadow-raised outline-hidden',
          className,
        )}
        style={`${popover.float.style}${style ?? ''}`}
        {@attach popover.content}
        transition:emerge={popover.float}
        onoutroend={() => (present = false)}
      >
        {@render children?.()}
      </div>
    {/if}
  </Portal>
{/if}
