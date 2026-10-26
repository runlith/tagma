<script lang="ts">
  import type { Snippet } from 'svelte';

  import { getAllContexts, mount, unmount } from 'svelte';

  import { getOverlayRoot } from './overlay-root.js';

  interface Props {
    disabled?: boolean;
    target?: HTMLElement;
    children: Snippet;
  }

  const context = getAllContexts();

  let { disabled = false, target = getOverlayRoot() ?? undefined, children }: Props = $props();

  $effect(() => {
    if (disabled || !target) return;

    const instance = mount(children, { target, context });
    return () => unmount(instance);
  });
</script>

{#if disabled || !target}
  {@render children?.()}
{/if}
