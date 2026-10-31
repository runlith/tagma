<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Square from '@lucide/svelte/icons/square';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import X from '@lucide/svelte/icons/x';
  import { Readings, silentWords } from '$lib/features/executions/load/Readings.svelte.js';
  import { detailOf, heaviest, percent, stopWords, totalMemory, type Lit, type Order } from '$lib/features/executions/load/rows.js';
  import { View } from '$lib/features/executions/load/View.svelte.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { formatBytes } from '$lib/shared/figures.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import LoadBackground from './LoadBackground.svelte';
  import LoadChart from './LoadChart.svelte';
  import LoadFigures from './LoadFigures.svelte';
  import PaceControl from './PaceControl.svelte';
  import PaceProblem from './PaceProblem.svelte';

  let { onOpen }: { onOpen: (thread: string | null) => void } = $props();

  const readings = Readings.use();
  const view = View.use();
  const clock = WallClock.use();

  $effect(() => clock.watch());

  let lit = $state<string | null>(null);

  const loaded = $derived(readings.view);
  const silent = $derived(readings.silent);
  const pressed = $derived(readings.pressed);
  const memory = $derived(loaded?.memory._tag === 'Measured' ? loaded.memory : null);
  const now = $derived(clock.now);
  const history = $derived(readings.history);
  const order = $derived<Order>(pressed === null ? 'cpu' : 'memory');
  const rows = $derived(loaded === null ? [] : heaviest(loaded, order, 3));
  const shown = $derived<Lit>(lit === null ? null : { _tag: 'Row', key: lit });

  const ALARM = 'flex shrink-0 gap-2 border-b border-border bg-sunken p-3';
  const ACT =
    'grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-foreground group-hover/glance:opacity-100 group-focus-within/glance:opacity-100 disabled:opacity-40';
</script>

<div class="flex min-h-0 flex-col text-small" data-load-glance>
  {#if silent !== null}
    <div class={ALARM} role="status" data-load-alarm="silent">
      {#if silent._tag === 'Connection'}
        <WifiOff class="mt-0.5 size-4 shrink-0 text-status-in-work" />
      {:else}
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-status-in-work" />
      {/if}
      <span class="grid min-w-0 flex-1 gap-0.5">
        <b class="text-ui font-semibold text-status-in-work">Load is not updating</b>
        <span class="text-muted-foreground">{silentWords(silent, now)}</span>
      </span>
    </div>
  {:else if loaded !== null}
    {#if pressed !== null && memory !== null}
      {@const tone = pressed === 'critical' ? 'text-destructive' : 'text-status-in-work'}
      <div class={ALARM} role="status" data-load-alarm="memory">
        <TriangleAlert class={['mt-0.5 size-4 shrink-0', tone]} />
        <span class="grid min-w-0 flex-1 gap-0.5">
          <b class={['text-ui font-semibold', tone]}>{pressed === 'critical' ? 'Memory is almost out' : 'Memory is tight'}</b>
          <span class="text-muted-foreground"
            >The system reports memory pressure: {formatBytes(memory.usedBytes)} of {formatBytes(memory.totalBytes)} in use. Tagma and its agents
            hold {totalMemory(loaded.totals.own)}.</span
          >
        </span>
      </div>
    {/if}
    {#if loaded.saturated}
      <div class={ALARM} role="status" data-load-alarm="cpu">
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-status-in-work" />
        <span class="grid min-w-0 flex-1 gap-1">
          <b class="text-ui font-semibold text-status-in-work">The CPU is saturated</b>
          <span class="text-muted-foreground"
            >Everything on the {loaded.machine} runs slower, Tagma included. Agents' commands can be given less of it.</span
          >
          <PaceControl />
          <PaceProblem class="bg-background" />
        </span>
      </div>
    {/if}
  {/if}

  <div class={['flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-3', silent !== null ? 'opacity-60' : '']}>
    {#if loaded === null}
      {#if silent === null}
        <p class="py-4 text-center text-muted-foreground">Reading the machine…</p>
      {/if}
    {:else}
      <span class="text-meta text-muted-foreground">Tagma and its agents</span>
      <LoadFigures />
      <LoadChart {history} layers={[]} lit={shown} scale="machine" />
      {#each loaded.background as work (work.id)}
        <LoadBackground {work} class="rounded-md bg-sunken p-2" />
      {/each}
      {#if rows.length > 0}
        <div class="-mx-3 flex flex-col" data-load-glance-rows>
          <div class="flex items-center gap-2 px-3 pb-1 text-meta text-muted-foreground">
            <span class="min-w-0 flex-1">{order === 'memory' ? 'Holding the most memory' : 'Heaviest now'}</span>
            <span class={['w-12 shrink-0 text-right', order === 'cpu' ? 'font-semibold text-foreground' : '']}>CPU</span>
            <span class={['w-16 shrink-0 text-right', order === 'memory' ? 'font-semibold text-foreground' : '']}>Memory</span>
            <span class="w-5 shrink-0"></span>
          </div>
          {#each rows as row (row.key)}
            {@const ending = view.ending(row.key, now)}
            {@const detail = detailOf(row)}
            {@const busy = view.working(row.key)}
            <div
              class="group/glance flex min-h-10 items-center gap-2 border-t border-vein px-3 hover:bg-hover"
              role="group"
              aria-label={row.title}
              data-load-glance-row={row.key}
              onpointerenter={() => (lit = row.key)}
              onpointerleave={() => (lit = null)}
            >
              <button type="button" class="flex min-w-0 flex-1 flex-col py-1 text-left" onclick={() => onOpen(row.thread ?? null)}>
                <FadeText class="font-medium" text={row.title} />
                {#if ending !== null}
                  <span
                    class={['text-meta', ending.failed ? 'text-destructive' : 'text-muted-foreground']}
                    role="status"
                    title={ending.hint}>{ending.text}</span
                  >
                {:else if detail !== ''}
                  <FadeText class="text-meta text-muted-foreground" text={detail} />
                {/if}
              </button>
              <span class={['stamp w-12 shrink-0 text-right', order === 'cpu' ? '' : 'text-muted-foreground']}>{percent(row.share)}</span>
              <span class={['stamp w-16 shrink-0 text-right', order === 'memory' ? '' : 'text-muted-foreground']}
                >{formatBytes(row.memoryBytes)}</span
              >
              <span class="grid w-5 shrink-0 place-items-center">
                {#if view.stoppable(row)}
                  <Tooltip text={stopWords(row)}>
                    <button
                      type="button"
                      class={[ACT, busy ? 'opacity-100' : '']}
                      aria-label={stopWords(row)}
                      disabled={busy}
                      onclick={() => void view.stop(row)}
                    >
                      {#if busy}
                        <Waiting class="size-3" />
                      {:else if row.kind === 'agent'}
                        <Square class="size-3 fill-current" />
                      {:else}
                        <X class="size-3.5" />
                      {/if}
                    </button>
                  </Tooltip>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <button
    type="button"
    class="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2 text-meta text-muted-foreground hover:bg-hover hover:text-foreground"
    data-load-open
    onclick={() => onOpen(null)}
  >
    <span>Every process, search and stop</span>
    <ArrowUpRight class="size-3" />
  </button>
</div>
