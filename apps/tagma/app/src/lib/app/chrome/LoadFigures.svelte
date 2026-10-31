<script lang="ts">
  import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
  import { figureHints, percent, totalMemory, totalShare, usedOf } from '$lib/features/executions/load/rows.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import LoadBar from './LoadBar.svelte';

  const readings = Readings.use();

  const loaded = $derived(readings.view);
  const memory = $derived(loaded?.memory._tag === 'Measured' ? loaded.memory : null);
  const hints = $derived(loaded === null ? null : figureHints(loaded, readings.pressed));
</script>

<div class="grid grid-cols-2 gap-4">
  <div class="grid min-w-0 content-start gap-1" title={hints?.cpu ?? 'The machine is not read yet'} data-load-cpu>
    <FadeText class="text-muted-foreground"
      >CPU <b class="text-page font-semibold text-foreground tabular-nums">{loaded === null ? '—' : totalShare(loaded.totals.own)}</b
      >{#if loaded !== null}<span class="ml-1 text-meta"
          >{loaded.machine}
          <span class={['tabular-nums', loaded.saturated ? 'text-status-in-work' : '']}>{percent(loaded.share)}</span></span
        >{/if}</FadeText
    >
    {#if loaded !== null && loaded.share !== null && loaded.totals.own.share !== null && loaded.totals.outside.share !== null}
      <LoadBar taken={loaded.totals.own.share} beside={loaded.totals.outside.share} />
    {/if}
  </div>
  <div class="grid min-w-0 content-start gap-1" title={hints?.memory ?? 'The machine is not read yet'} data-load-memory>
    <FadeText class="text-muted-foreground"
      >Memory <b class="text-page font-semibold text-foreground tabular-nums">{loaded === null ? '—' : totalMemory(loaded.totals.own)}</b
      >{#if loaded !== null && memory !== null}<span class="ml-1 text-meta"
          >{loaded.machine}
          <span
            class={['tabular-nums', readings.pressed === null ? '' : 'text-status-in-work']}
            data-load-pressure={readings.pressed ?? undefined}>{usedOf(memory.usedBytes, memory.totalBytes)}</span
          ></span
        >{/if}</FadeText
    >
    {#if memory !== null && loaded !== null && loaded.totals.own.memoryBytes !== null && loaded.totals.outside.memoryBytes !== null}
      <LoadBar taken={loaded.totals.own.memoryBytes / memory.totalBytes} beside={loaded.totals.outside.memoryBytes / memory.totalBytes} />
    {/if}
  </div>
</div>
