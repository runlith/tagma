<script lang="ts">
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { billing } from '$lib/features/providers/served.js';

  let { provider }: { provider: string } = $props();

  const catalog = ProviderCatalog.use();
  const billed = $derived(billing(catalog.models, provider));
</script>

<span data-team-provider={provider}>{catalog.modeName(provider)}</span>{#if billed !== null}<span
    class="ml-1.5 font-normal text-muted-foreground">{billed}</span
  >{/if}
