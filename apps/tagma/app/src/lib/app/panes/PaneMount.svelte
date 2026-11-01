<script lang="ts">
  import { untrack } from 'svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import Told from '$lib/shared/Told.svelte';
  import { SidePanes } from './SidePanes.svelte.js';

  let { pane }: { pane: SidePane } = $props();

  const panes = SidePanes.use();
  const declared = untrack(() => panes.kinds.declared(pane.kind));
  const allowed = $derived(panes.gate.allows(declared.right));
  const short = $derived(declared.right === undefined || allowed ? undefined : panes.gate.right(declared.right));
  const loading = $derived(allowed ? untrack(() => declared.view()) : undefined);
</script>

{#if loading !== undefined}
  {#await loading then loaded}
    {@const View = loaded.default}
    <View {pane} close={() => panes.close(pane.key)} />
  {/await}
{:else if short !== undefined}
  {@const hint = panes.hints?.hint(short)}
  <div class="p-4 text-ui" data-pane-gated>
    <Told told={{ text: 'Not included in this access', note: hint?.note, act: hint?.act, details: short.unblock, code: 'right-missing' }} />
  </div>
{/if}
