<script lang="ts">
  import KeyCard from '$lib/features/settings/KeyCard.svelte';
  import Secrets from '$lib/features/tagma-apps/Secrets.svelte';
  import type { SectionProps } from '$lib/features/settings/section.js';

  let { catalog, scope, project }: SectionProps = $props();

  const entries = $derived(catalog.entriesOf('apps'));
</script>

<div class="grid">
  {#if project}
    <Secrets projectId={project.id} />
  {/if}

  {#if entries.length > 0}
    <KeyCard title="Apps" {entries} {catalog} {scope} {project} />
  {/if}
</div>
