<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  import { useDialogRootContext } from './context.svelte.js';

  type Props = Omit<HTMLButtonAttributes, 'onclick'> & {
    onclick?: (event: MouseEvent) => void;
    child?: Snippet<[{ props: Record<string, unknown> }]>;
    children?: Snippet;
    dataSlot?: string;
  };

  let { class: className, children, child, onclick, type = 'button', dataSlot = 'dialog-close', ...restProps }: Props = $props();

  const ctx = useDialogRootContext();

  const handleClick = (event: MouseEvent): void => {
    onclick?.(event);
    if (event.defaultPrevented) return;
    ctx.setOpen(false);
  };

  const closeProps = $derived.by(() => ({
    ...restProps,
    type,
    class: className,
    onclick: handleClick,
    'data-slot': dataSlot,
  }));
</script>

{#if child}
  {@render child({ props: closeProps })}
{:else}
  <button {...closeProps}>
    {@render children?.()}
  </button>
{/if}
