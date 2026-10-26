<script lang="ts">
  import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
  import { percent, totalMemory, totalShare, totalUnread } from '$lib/features/executions/load/rows.js';
  import { formatBytes } from '$lib/shared/figures.js';
  import LoadBar from './LoadBar.svelte';

  const readings = Readings.use();

  const loaded = $derived(readings.view);
  const memory = $derived(loaded?.memory._tag === 'Measured' ? loaded.memory : null);
</script>

<div class="grid gap-2">
  <div class="grid grid-cols-2 gap-4">
    <div class="grid min-w-0 content-start gap-1.5" data-load-cpu>
      <span class="flex items-baseline gap-1.5">
        <span class="text-muted-foreground">CPU</span>
        <b class="text-page font-semibold tabular-nums" title={loaded === null ? undefined : totalUnread(loaded.totals.own)}
          >{loaded === null ? '—' : totalShare(loaded.totals.own)}</b
        >
      </span>
      {#if loaded !== null && loaded.share !== null && loaded.totals.own.share !== null && loaded.totals.outside.share !== null}
        <LoadBar taken={loaded.totals.own.share} beside={loaded.totals.outside.share} />
      {/if}
      <span class="text-meta text-muted-foreground">
        {#if loaded !== null}
          Mac <span class={['font-medium tabular-nums', loaded.saturated ? 'text-status-in-work' : 'text-foreground']}
            >{percent(loaded.share)}</span
          >
          of {loaded.cores} cores
        {:else}
          The Mac is not read yet
        {/if}
      </span>
    </div>
    <div class="grid min-w-0 content-start gap-1.5" data-load-memory>
      <span class="flex items-baseline gap-1.5">
        <span class="text-muted-foreground">Memory</span>
        <b class="text-page font-semibold tabular-nums">{loaded === null ? '—' : totalMemory(loaded.totals.own)}</b>
      </span>
      {#if memory !== null && loaded !== null && loaded.totals.own.memoryBytes !== null && loaded.totals.outside.memoryBytes !== null}
        <LoadBar taken={loaded.totals.own.memoryBytes / memory.totalBytes} beside={loaded.totals.outside.memoryBytes / memory.totalBytes} />
      {/if}
      <span class="text-meta text-muted-foreground">
        {#if memory !== null}
          Mac <span class={['font-medium tabular-nums', readings.pressed === null ? 'text-foreground' : 'text-status-in-work']}
            >{formatBytes(memory.usedBytes)}</span
          >
          of {formatBytes(memory.totalBytes)}{#if readings.pressed !== null}<span class="font-medium text-status-in-work" data-load-pressure
              >, pressure {readings.pressed}</span
            >{/if}
        {:else}
          Mac memory is not read
        {/if}
      </span>
    </div>
  </div>
  <span class="flex gap-3 text-meta text-muted-foreground" data-load-legend>
    <span class="flex items-center gap-1"><i class="size-2 bg-brand"></i>Tagma</span>
    <span class="flex items-center gap-1"><i class="size-2 bg-muted-foreground/35"></i>Rest of the Mac</span>
    <span class="flex items-center gap-1"><i class="size-2 border border-vein-strong bg-sunken"></i>Free</span>
  </span>
</div>
