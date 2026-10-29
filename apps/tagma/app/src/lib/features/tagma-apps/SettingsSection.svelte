<script lang="ts">
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import Secrets from '$lib/features/tagma-apps/Secrets.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';
  import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';

  let { catalog, scope, project }: SectionProps = $props();

  const contributions = SectionRegistry.use().contributionsTo('apps');
  const entries = $derived(catalog.entriesOf('apps'));
</script>

<div class="grid">
  {#if project}
    <Secrets projectId={project.id} />
  {/if}

  {#each contributions as contribution, index (index)}
    {@const View = contribution.view}
    <View {catalog} {scope} {project} />
  {/each}

  {#if entries.length > 0}
    <KeyCard title="Apps" {entries} {catalog} {scope} {project} />
  {/if}
</div>
