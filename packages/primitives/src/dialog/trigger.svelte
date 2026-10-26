<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  import { flushSync } from 'svelte';

  import { useDialogRootContext } from './context.svelte.js';

  type Props = HTMLButtonAttributes & {
    ref?: HTMLButtonElement | null;
    children?: Snippet;
  };

  let { ref = $bindable(null), class: className, disabled = false, type = 'button', children, onclick, ...restProps }: Props = $props();

  const ctx = useDialogRootContext();

  const handleClick = (event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }): void => {
    onclick?.(event);
    if (event.defaultPrevented) return;
    if (disabled) return;
    flushSync(() => {
      ctx.setOpen(true);
    });
  };
</script>

<button
  {...restProps}
  bind:this={ref}
  {@attach ctx.layer.trigger}
  {type}
  class={className}
  {disabled}
  data-state={ctx.open ? 'open' : 'closed'}
  onclick={handleClick}
>
  {@render children?.()}
</button>
