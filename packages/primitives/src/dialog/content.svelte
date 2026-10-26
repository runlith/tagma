<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  import type { DialogMotion } from '../types.js';
  import { focusInitialIn, focusSafely } from '../focus.js';
  import { useDialogRootContext } from './context.svelte.js';
  import { resolveDialogMotion } from './motion.js';
  import { dialogContentTransition } from './transition.js';

  export type Props = HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLDivElement | null;
    children: Snippet;
    motion?: DialogMotion['content'];
    onCloseComplete?: () => void;
    onPresent?: () => void;
    role?: 'dialog' | 'alertdialog';
  };

  let {
    ref = $bindable(null),
    class: className,
    style,
    children,
    motion,
    onCloseComplete,
    onPresent,
    role = 'dialog',
    'aria-label': ariaLabel,
    ...restProps
  }: Props = $props();

  const ctx = useDialogRootContext();
  const resolvedMotion = $derived.by(() => (motion ? resolveDialogMotion({ content: motion }).content : ctx.motion.content));

  $effect(() => {
    ctx.setContentEl(ref);
    if (ref) onPresent?.();
    return () => {
      if (ctx.contentEl === ref) ctx.setContentEl(null);
    };
  });

  let wasOpen = false;

  const takeFocus = (content: HTMLElement): void => {
    if (focusInitialIn(content)) return;
    focusSafely(content);
  };

  $effect(() => {
    if (!ctx.open || wasOpen || !ref) return;
    wasOpen = true;
    const content = ref;

    content.scrollTop = 0;
    takeFocus(content);

    const frame = requestAnimationFrame(() => {
      if (!ctx.open || !content.isConnected) return;
      if (content.contains(document.activeElement)) return;
      takeFocus(content);
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (ctx.open) return;
    wasOpen = false;
  });

  $effect(() => {
    if (!ctx.open || !ref) return;

    const content = ref;

    const handleFocusOut = (event: FocusEvent): void => {
      if (event.relatedTarget !== null) return;
      queueMicrotask(() => {
        if (!ctx.open || !content.isConnected) return;
        if (document.activeElement !== document.body) return;
        focusSafely(content);
      });
    };

    content.addEventListener('focusout', handleFocusOut);
    return () => content.removeEventListener('focusout', handleFocusOut);
  });
</script>

{#if ctx.present}
  <div
    {...restProps}
    bind:this={ref}
    {@attach ctx.layer.surface}
    class={className}
    style={`z-index:${ctx.layer.z};${style ?? ''}`}
    tabindex="-1"
    {role}
    aria-modal="true"
    aria-label={ariaLabel}
    aria-labelledby={ariaLabel === undefined ? ctx.titleId : undefined}
    aria-describedby={ctx.descriptionId}
    transition:dialogContentTransition={resolvedMotion}
    data-state={ctx.open ? 'open' : 'closed'}
    data-runlith-dialog-content
    onoutroend={() => onCloseComplete?.()}
  >
    {@render children?.()}
  </div>
{/if}
