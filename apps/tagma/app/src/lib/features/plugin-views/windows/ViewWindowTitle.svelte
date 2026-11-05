<script lang="ts">
  import { ViewSets } from '../ViewSets.svelte.js';

  let { plugin, view }: { plugin: string; view: string } = $props();

  const sets = ViewSets.use();
  const title = $derived(sets.view(plugin, view)?.set.title ?? plugin);
</script>

<svelte:head><title>{title}</title></svelte:head>
