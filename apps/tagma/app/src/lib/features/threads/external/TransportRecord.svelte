<script lang="ts">
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import type { TransportEntry } from '@tagma/server/threads/contract/wire/harness/transportEntry';
  import { transportName } from './transport.js';

  let { entry }: { entry: TransportEntry } = $props();
</script>

<p class="my-1 flex items-center gap-2 text-small text-muted-foreground" data-transport-switch={entry.to}>
  <ArrowRightLeft class="size-3.5 shrink-0" />
  <span
    >{entry.from === entry.to
      ? `Transport restored to ${transportName(entry.to)}`
      : entry.from === null
        ? `Moved to ${transportName(entry.to)}`
        : `Moved from ${transportName(entry.from)} to ${transportName(entry.to)}`}</span
  >
</p>
