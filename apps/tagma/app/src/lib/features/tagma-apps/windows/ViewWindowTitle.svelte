<script lang="ts">
  import { ViewSets } from '../ViewSets.svelte.js';

  let { tagmaApp, view }: { tagmaApp: string; view: string } = $props();

  const sets = ViewSets.use();
  const title = $derived(sets.view(tagmaApp, view)?.set.title ?? tagmaApp);
</script>

<svelte:head><title>{title}</title></svelte:head>
