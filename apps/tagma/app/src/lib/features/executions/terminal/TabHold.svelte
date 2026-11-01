<script lang="ts">
  import { untrack } from 'svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { holdTerminal } from './owner.js';

  let { pane }: { pane: SidePane } = $props();

  holdTerminal(untrack(() => pane.id));
</script>
