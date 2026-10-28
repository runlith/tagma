<script lang="ts">
  import { Ledger, Machine } from './handoff-fixtures.svelte.js';

  Ledger.use();
  const machine = Machine.use();
</script>

<div data-testid="blocker">{machine.blocker ?? 'ready'}</div>
