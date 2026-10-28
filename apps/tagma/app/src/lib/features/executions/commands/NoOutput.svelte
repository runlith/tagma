<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { formatBytes } from '$lib/shared/figures.js';
  import { Readings } from '../load/Readings.svelte.js';
  import { executionProcesses, percent } from '../load/rows.js';
  import { isLive, type ProcessLine } from '../processes/lines.js';

  let { line, class: className }: { line: ProcessLine; class?: ClassValue } = $props();

  const SHOWN = 6;

  const readings = Readings.use();
  const live = $derived(isLive(line));
  const load = $derived(live ? readings.execution(line.owner.thread, line.key) : null);

  $effect(() => (live ? readings.hold() : undefined));

  type Shown = {
    readonly pid: number | null;
    readonly depth: number;
    readonly command: string;
    readonly share: number | null;
    readonly memoryBytes: number | null;
  };

  const branches = $derived(load === null ? [] : executionProcesses(load.row, load.execution.key));
  const read = $derived(branches.length > 0);
  const rows = $derived.by((): readonly Shown[] => {
    if (read)
      return branches.map(({ process, depth }) => ({
        pid: process.pid,
        depth,
        command: process.command?.trim() || process.name,
        share: process.share,
        memoryBytes: process.memoryBytes,
      }));
    return line.current === null ? [] : [{ pid: line.currentPid, depth: 0, command: line.current, share: null, memoryBytes: null }];
  });
  const heading = $derived(
    load === null ? 'No output yet — CPU and memory not measured' : read ? 'No output yet' : 'No output yet — its processes were not read',
  );
</script>

{#if live}
  <div class={['grid min-w-0 gap-x-3 py-1', className]} style:grid-template-columns="minmax(0, 1fr) auto auto" data-no-output>
    <div class="col-span-full flex h-6 items-center justify-between gap-3 px-3 text-small text-muted-foreground">
      <FadeText text={heading} />
      {#if read}
        <span class="shrink-0 text-meta tabular text-muted-foreground/70">{rows.length} {rows.length === 1 ? 'process' : 'processes'}</span>
      {/if}
    </div>
    {#each rows.slice(0, SHOWN) as row, at (row.pid ?? at)}
      <div
        class={[
          'col-span-full grid h-6 grid-cols-subgrid items-center px-3 font-mono text-small',
          row.pid !== null && row.pid === line.currentPid ? 'text-foreground' : 'text-muted-foreground',
        ]}
      >
        <span class="flex min-w-0 items-center">
          {#if row.depth > 0}
            <span class="shrink-0" style:width={`calc(var(--spacing) * ${(row.depth - 1) * 3.5})`}></span>
            <span class="mr-1.5 mb-1.5 size-2 shrink-0 border-b border-l border-vein-strong"></span>
          {/if}
          <FadeText class="flex-1" text={row.command} />
        </span>
        <span class="text-right text-meta tabular">{percent(row.share)}</span>
        <span class="text-right text-meta tabular">{formatBytes(row.memoryBytes)}</span>
      </div>
    {/each}
    {#if rows.length > SHOWN}
      <span class="col-span-full h-6 px-3 text-small leading-6 text-muted-foreground/60">+{rows.length - SHOWN} more</span>
    {/if}
  </div>
{:else}
  <p class="text-small text-muted-foreground/70" data-no-output>Printed nothing</p>
{/if}
