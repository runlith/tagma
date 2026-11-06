<script lang="ts">
  import { PLUGIN_LINK } from '@tagma/server/plugins/contract/wire/link';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { ProviderCatalog } from './Catalog.svelte.js';

  let { projectId }: { projectId: number | null } = $props();

  const catalog = ProviderCatalog.use();
  const opening = Opening.use();

  const failed = $derived(catalog.served.adapters.flatMap((adapter) => (adapter.state === 'failed' ? [adapter] : [])));
</script>

{#each failed as adapter (adapter.id)}
  <Callout tone="error" title="The plugin {adapter.id} could not load its providers" note={adapter.reason}>
    {#snippet actions()}
      {#if projectId !== null}
        <Button
          size="sm"
          variant="outline"
          onclick={() => void opening.open({ kind: PLUGIN_LINK, target: { projectId, id: adapter.id } }, 'full')}
        >
          Open its card
        </Button>
      {/if}
    {/snippet}
  </Callout>
{/each}
