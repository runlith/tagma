<script lang="ts">
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';

  let { catalog, scope, project }: SectionProps = $props();

  const contributions = SectionRegistry.use().contributionsTo('plugins');
  const entries = $derived(catalog.entriesOf('plugins'));
</script>

<div class="grid">
  {#each contributions as contribution, index (index)}
    {@const View = contribution.view}
    <View {catalog} {scope} {project} />
  {/each}

  {#if entries.length > 0}
    <KeyCard title="Plugins" {entries} {catalog} {scope} {project} />
  {/if}
</div>
