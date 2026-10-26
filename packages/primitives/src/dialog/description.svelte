<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  import { useDialogRootContext } from './context.svelte.js';

  type Props = HTMLAttributes<HTMLParagraphElement> & {
    children: Snippet;
  };

  let { id, class: className, children, ...restProps }: Props = $props();

  const ctx = useDialogRootContext();
  const ownId = $props.id();
  const resolvedId = $derived(id ?? ownId);

  $effect(() => {
    ctx.setDescriptionId(resolvedId);
    return () => {
      if (ctx.descriptionId === resolvedId) ctx.setDescriptionId(undefined);
    };
  });
</script>

<p {...restProps} id={resolvedId} class={className} data-slot="dialog-description">
  {@render children?.()}
</p>
