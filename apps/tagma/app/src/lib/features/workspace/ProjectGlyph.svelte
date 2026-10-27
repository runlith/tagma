<script lang="ts">
  import Network from '@lucide/svelte/icons/network';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import Swatch from './Swatch.svelte';

  let { project }: { project: Project } = $props();
</script>

{#if project.global}<Network class="size-3.5" />{:else}<Swatch projectId={project.id} />{/if}
