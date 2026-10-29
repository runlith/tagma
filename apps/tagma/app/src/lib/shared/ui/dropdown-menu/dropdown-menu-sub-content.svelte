<script lang="ts">
  import Portal from '@runlith/primitives/Portal.svelte';
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { PlaceOptions } from '@runlith/primitives/place';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let {
    class: className,
    style,
    side,
    align,
    sideOffset = 2,
    alignOffset = -5,
    collisionPadding,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & PlaceOptions = $props();

  const menu = Menu.use();
  menu.conduct = () => ({ side, align, sideOffset, alignOffset, collisionPadding });
</script>

{#if menu.open}
  <Portal>
    <div
      {...rest}
      id={menu.id}
      role="menu"
      aria-orientation="vertical"
      aria-labelledby={menu.labelledBy}
      data-slot="dropdown-menu-sub-content"
      data-side={menu.float.side}
      data-align={menu.float.align}
      class={cn(
        'max-h-(--float-available-height) w-auto min-w-24 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised outline-none',
        className,
      )}
      style={`${menu.float.style}${style ?? ''}`}
      {@attach menu.content}
    >
      {@render children?.()}
    </div>
  </Portal>
{/if}
