<script lang="ts">
  import type { TeamModelKey } from '@runlith/agent/collaboration/team';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { rowName } from './words.js';

  let { row, named = false }: { row: TeamModelKey; named?: boolean } = $props();

  const catalog = ProviderCatalog.use();
  const name = $derived(rowName(catalog.models, row));
</script>

<FadeText class="flex-1"
  >{name.label}{#if name.rung !== null}<span class="ml-1.5 text-muted-foreground">{name.rung}</span>{/if}{#if named}<span
      class="ml-2 text-muted-foreground">{catalog.modeName(row.provider)}</span
    >{/if}</FadeText
>
