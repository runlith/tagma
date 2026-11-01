<script lang="ts">
  import { untrack } from 'svelte';
  import { Access, AccessHint, gateOf } from '$lib/wire/access.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import Told from '$lib/shared/Told.svelte';
  import { SidePanes } from './SidePanes.svelte.js';

  let { pane }: { pane: SidePane } = $props();

  const panes = SidePanes.use();
  const gate = gateOf(Access.find(), 'read');
  const hints = AccessHint.find();
  const declared = untrack(() => panes.kinds.declared(pane.kind));
  const allowed = $derived(gate.allows(declared.right));
  const short = $derived(declared.right === undefined || allowed ? undefined : gate.right(declared.right));
  const loading = $derived(allowed ? untrack(() => declared.view()) : undefined);
</script>

{#if loading !== undefined}
  {#await loading then loaded}
    {@const View = loaded.default}
    <View {pane} close={() => panes.close(pane.key)} />
  {/await}
{:else if short !== undefined}
  {@const hint = hints?.hint(short)}
  <div class="p-4 text-ui" data-pane-gated>
    <Told told={{ text: 'Not included in this access', note: hint?.note, act: hint?.act, details: short.unblock, code: 'right-missing' }} />
  </div>
{/if}
