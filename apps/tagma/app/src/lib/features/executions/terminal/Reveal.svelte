<script lang="ts">
  import { untrack } from 'svelte';
  import { terminalPaneOf } from '../kind.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { holdTerminal } from './owner.js';

  let { address }: { address: string } = $props();

  const shown = ProjectRung.Current.use().projectId;
  const terminals = holdTerminal(untrack(() => address));
  const place = untrack(() => terminalPaneOf(address, terminals.projectId));
  $effect(() => {
    if (place !== null) untrack(() => void terminals.reveal(place.key, shown));
  });
</script>
