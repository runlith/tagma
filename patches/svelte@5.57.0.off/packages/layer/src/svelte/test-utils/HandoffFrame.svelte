<script lang="ts">
  import { Ledger, Machine, Search } from './handoff-fixtures.svelte.js';

  let { awaits = false }: { awaits?: boolean } = $props();

  Ledger.use();
  const machine = Machine.use();
  if (awaits) await Search.use();
</script>

<div data-testid="blocker">{machine.blocker ?? 'ready'}</div>
