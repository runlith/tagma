<script lang="ts">
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { billedLabel } from '$lib/features/providers/served.js';
  import Usage from './Usage.svelte';

  let { provider }: { provider: string } = $props();

  const catalog = ProviderCatalog.use();
</script>

<span data-team-provider={provider}>{billedLabel(catalog.models, provider, catalog.modeName(provider))}</span>
<span class="ml-1.5 font-normal"><Usage {provider} part="percent" /></span>
