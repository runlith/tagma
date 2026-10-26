<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  import { useDialogRootContext } from './context.svelte.js';

  type Props = HTMLAttributes<HTMLHeadingElement> & {
    children: Snippet;
  };

  let { id, class: className, children, ...restProps }: Props = $props();

  const ctx = useDialogRootContext();
  const ownId = $props.id();
  const resolvedId = $derived(id ?? ownId);

  $effect(() => {
    ctx.setTitleId(resolvedId);
    return () => {
      if (ctx.titleId === resolvedId) ctx.setTitleId(undefined);
    };
  });
</script>

<h2 {...restProps} id={resolvedId} class={className} data-slot="dialog-title">
  {@render children?.()}
</h2>
