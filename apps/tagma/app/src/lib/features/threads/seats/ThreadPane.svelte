<script lang="ts">
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { paneThread } from './pane.js';
  import ThreadView from './ThreadView.svelte';

  let { pane, close }: { pane: SidePane; close: () => void } = $props();

  const home = $derived(paneThread(pane.id).home);
</script>

{#key home}
  <ThreadView {pane} {close} />
{/key}
