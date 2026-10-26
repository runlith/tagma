<script lang="ts">
  import Portal from '@runlith/primitives/Portal.svelte';
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { PlaceOptions } from '@runlith/primitives/place';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { emerge } from '../emerge.js';

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

  let present = $state(false);
  $effect.pre(() => {
    if (menu.open) present = true;
  });
</script>

{#if present}
  <Portal>
    {#if menu.open}
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
          'max-h-(--float-available-height) w-auto min-w-24 origin-(--float-origin) overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised outline-none',
          className,
        )}
        style={`${menu.float.style}${style ?? ''}`}
        {@attach menu.content}
        transition:emerge={menu.float}
        onoutroend={() => (present = false)}
      >
        {@render children?.()}
      </div>
    {/if}
  </Portal>
{/if}
