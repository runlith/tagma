<script lang="ts">
  import Portal from '@runlith/primitives/Portal.svelte';
  import { Select } from '@runlith/primitives/select.svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';
  import { emerge } from '../emerge.js';

  let { class: className, style, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();

  const select = Select.use();

  let present = $state(false);
  $effect.pre(() => {
    if (select.open) present = true;
  });
</script>

{#if present}
  <Portal>
    {#if select.open}
      <div
        {...rest}
        id={select.id}
        role="listbox"
        data-slot="select-content"
        data-state={select.open ? 'open' : 'closed'}
        data-side={select.float.side}
        data-align={select.float.align}
        class={cn(
          'min-w-(--float-anchor-width) max-h-(--float-available-height) origin-(--float-origin) scroll-py-1 overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised outline-hidden',
          className,
        )}
        style={`${select.float.style}${style ?? ''}`}
        {@attach select.listbox}
        transition:emerge={select.float}
        onoutroend={() => (present = false)}
      >
        {@render children?.()}
      </div>
    {/if}
  </Portal>
{/if}
{#if !select.open}
  <Portal target={select.shelf}>
    {@render children?.()}
  </Portal>
{/if}
