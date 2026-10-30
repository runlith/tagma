<script lang="ts">
  import type { SectionProps } from '$lib/features/settings/section.js';
  import Elsewhere from '$lib/features/plugins/Elsewhere.svelte';

  let { project }: SectionProps = $props();
</script>

<div class="grid pt-4">
  <Elsewhere {project} what="Plugins, the services they connect and the sources they come from" />
</div>
