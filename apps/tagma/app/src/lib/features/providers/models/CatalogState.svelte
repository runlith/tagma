<script lang="ts">
  import type { ServedProvider } from '@tagma/server/providers/contract/wire/catalog';

  let { served }: { served: ServedProvider | undefined } = $props();
</script>

{#if served?.catalogState?.failure}
  <p class="border-t border-border px-3 py-2 text-small text-severity-gap">{served.catalogState.failure}</p>
{/if}
{#each served?.catalogState?.warnings ?? [] as warning}
  <p class="border-t border-border px-3 py-2 text-small text-muted-foreground">{warning}</p>
{/each}
