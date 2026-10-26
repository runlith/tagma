<script lang="ts" generics="TComponent">
  import type { Snippet } from 'svelte';

  let {
    open,
    load,
    onLoadFailure,
    children,
  }: {
    open: boolean;
    load: () => Promise<{ default: TComponent }>;
    onLoadFailure?: (error: unknown) => void;
    children: Snippet<[TComponent]>;
  } = $props();

  let loading: Promise<{ default: TComponent }> | undefined;

  const chunk = $derived.by(() => {
    if (open && !loading) {
      loading = load().catch((error: unknown) => {
        onLoadFailure?.(error);
        return new Promise<{ default: TComponent }>(() => undefined);
      });
    }
    return loading;
  });
</script>

{#if chunk}
  {#await chunk then { default: Loaded }}
    {@render children(Loaded)}
  {/await}
{/if}
