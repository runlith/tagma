<script lang="ts">
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import CommitSeat from './CommitSeat.svelte';
  import { commitOf } from './paneContent.js';

  let { pane }: { pane: SidePane; close: () => void } = $props();

  const shown = $derived(commitOf(pane.id));
</script>

{#if shown !== null}
  {#key pane.id}
    <CommitSeat projectId={shown.projectId} sha={shown.sha} />
  {/key}
{/if}
