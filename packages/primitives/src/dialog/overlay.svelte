<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';

  import { fade } from 'svelte/transition';

  import { useDialogRootContext } from './context.svelte.js';

  type Props = HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLDivElement | null;
  };

  let { ref = $bindable(null), class: className, style, onclick, ...restProps }: Props = $props();

  const ctx = useDialogRootContext();

  const handleClick = (event: MouseEvent & { currentTarget: EventTarget & HTMLDivElement }): void => {
    onclick?.(event);
    if (event.defaultPrevented) return;
    if (ctx.interactOutsideBehavior === 'ignore') return;
    ctx.setOpen(false);
  };
</script>

{#if ctx.present}
  <div
    data-slot="dialog-overlay"
    {...restProps}
    bind:this={ref}
    {@attach ctx.layer.surface}
    class={className}
    style={`z-index:${ctx.layer.z};${style ?? ''}`}
    transition:fade={{ duration: ctx.motion.overlay.durationMs, easing: ctx.motion.overlay.easing }}
    data-state={ctx.open ? 'open' : 'closed'}
    onclick={handleClick}
  ></div>
{/if}
