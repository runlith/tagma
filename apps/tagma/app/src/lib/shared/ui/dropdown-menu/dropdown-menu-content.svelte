<script lang="ts">
  import Portal from '@runlith/primitives/Portal.svelte';
  import { Menu, type MenuConduct } from '@runlith/primitives/menu.svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { emerge } from '../emerge.js';

  let {
    class: className,
    style,
    side,
    align = 'start',
    sideOffset = 4,
    alignOffset,
    collisionPadding,
    anchor,
    returnFocus,
    dismissOnFocusOutside,
    portal,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & MenuConduct & { portal?: HTMLElement } = $props();

  const menu = Menu.use();
  menu.conduct = () => ({ side, align, sideOffset, alignOffset, collisionPadding, anchor, returnFocus, dismissOnFocusOutside });

  let present = $state(false);
  $effect.pre(() => {
    if (menu.open) present = true;
  });
</script>

{#if present}
  <Portal target={portal}>
    {#if menu.open}
      <div
        {...rest}
        id={menu.id}
        role="menu"
        aria-orientation="vertical"
        aria-labelledby={menu.labelledBy}
        data-slot="dropdown-menu-content"
        data-side={menu.float.side}
        data-align={menu.float.align}
        class={cn(
          'max-h-(--float-available-height) w-(--float-anchor-width) min-w-32 origin-(--float-origin) overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised outline-none',
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
