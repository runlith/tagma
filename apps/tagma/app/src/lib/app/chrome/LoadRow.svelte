<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import type { LoadPoint, LoadProcess } from '@tagma/server/executions/contract/wire/load';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { threadLink } from '$lib/features/presence/link.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { formatBytes } from '$lib/shared/figures.js';
  import {
    detailOf,
    percent,
    processTitle,
    reapedOf,
    reapedWords,
    rowGpu,
    shareWords,
    sparkOf,
    stopWords,
    type Layer,
    type Shown,
  } from '$lib/features/executions/load/rows.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { View } from '$lib/features/executions/load/View.svelte.js';
  import LoadSpark from './LoadSpark.svelte';

  let {
    shown,
    layer,
    history,
    end,
    now,
    open,
    gpu = false,
    flash = false,
    onToggle,
    onLit,
  }: {
    shown: Shown;
    gpu?: boolean;
    layer: Layer | undefined;
    history: readonly LoadPoint[];
    end: number;
    now: number;
    open: boolean;
    flash?: boolean;
    onToggle: () => void;
    onLit: (key: string | null) => void;
  } = $props();

  const view = View.use();
  const opening = Opening.use();
  const surface = App.current();
  const row = $derived(shown.row);
  const processes = $derived(shown.processes ?? (open ? row.processes : []));
  const ending = $derived(view.ending(row.key, now));
  const stopping = $derived(view.working(row.key));
  const agent = $derived(row.kind === 'agent');
  const detail = $derived(detailOf(row));
  const partial = $derived(shareWords(row));

  const CELLS = 'flex shrink-0 items-center gap-2 tabular-nums';
  const FIGURE = 'stamp w-12 text-right whitespace-nowrap';
  const MEMORY = 'stamp w-16 text-right whitespace-nowrap text-muted-foreground';
  const ACT =
    'grid size-5 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-foreground group-hover/load:opacity-100 group-focus-within/load:opacity-100 disabled:opacity-40';
</script>

{#snippet gutter(act: (() => void) | null, words: string, busy: boolean, quit: boolean)}
  <span class="grid w-5 shrink-0 place-items-center">
    {#if act !== null}
      <Tooltip text={words}>
        <button type="button" class={[ACT, busy ? 'opacity-100' : '']} aria-label={words} disabled={busy} onclick={act}>
          {#if busy}<Waiting class="size-3" />{:else if quit}<X class="size-3.5" />{:else}<Square class="size-3 fill-current" />{/if}
        </button>
      </Tooltip>
    {/if}
  </span>
{/snippet}

{#snippet processRow(one: LoadProcess)}
  {@const key = `${row.key}/${one.pid}`}
  {@const outcome = view.ending(key, now)}
  {@const title = processTitle(one)}
  {@const reaped = reapedOf(one)}
  <div class="group/load flex h-6 items-center gap-2 pr-2 pl-8 text-small hover:bg-hover" data-load-process={one.pid}>
    <span class="flex min-w-0 flex-1 items-baseline gap-1.5" title={one.command ?? one.name}>
      <FadeText text={title} />
      <span class="stamp shrink-0 text-meta text-muted-foreground">{one.pid}</span>
      {#if reaped !== null}<span class="stamp shrink-0 text-meta text-muted-foreground" title={reapedWords(one, reaped)}
          >{percent(reaped)} in children</span
        >{/if}
      {#if outcome !== null}<span
          class={['shrink-0 text-meta', outcome.failed ? 'text-destructive' : 'text-muted-foreground']}
          role="status"
          title={outcome.hint}>{outcome.text}</span
        >{/if}
    </span>
    <span class={CELLS}>
      <span class={[FIGURE, 'text-muted-foreground']} title={one.unread}>{one.share === null ? '—' : percent(one.share)}</span>
      {#if gpu}<span class={[FIGURE, 'text-muted-foreground']} title={one.gpuUnread}>{one.gpu === undefined ? '—' : percent(one.gpu)}</span
        >{/if}
      <span class={MEMORY}>{one.memoryBytes === null ? '—' : formatBytes(one.memoryBytes)}</span>
    </span>
    {@render gutter(one.killable ? () => void view.kill(row, one) : null, `Kill ${title} (pid ${one.pid})`, view.working(key), true)}
  </div>
{/snippet}

<div
  class={['group/load border-t border-vein', flash ? 'bg-selected' : '']}
  role="group"
  aria-label={row.title}
  data-load-row={row.key}
  data-load-kind={row.kind}
  onpointerenter={() => onLit(row.key)}
  onpointerleave={() => onLit(null)}
  onfocusin={() => onLit(row.key)}
  onfocusout={() => onLit(null)}
>
  <div class="flex min-h-8 items-center gap-2 pr-2 pl-2 hover:bg-hover">
    <button
      type="button"
      class="grid size-4 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
      aria-label={open ? `Hide the processes of ${row.title}` : `Show the processes of ${row.title}`}
      aria-expanded={open}
      data-load-option
      onclick={onToggle}
    >
      <ChevronRight class={['size-3 transition-transform', open ? 'rotate-90' : '']} />
    </button>
    <span class="flex min-w-0 flex-1 flex-col py-1">
      <span class="flex min-w-0 items-center gap-1.5">
        {#if layer !== undefined}<i class="block size-2 shrink-0 {layer.dot}" aria-hidden="true"></i>{/if}
        {#if agent && row.thread !== undefined && row.project !== undefined}
          {@const link = threadLink({ threadId: row.thread, projectId: row.project.id })}
          <button type="button" class="min-w-0 text-left font-medium hover:underline" {@attach linkTarget(opening, () => link, surface)}
            ><FadeText text={row.title} /></button
          >
        {:else}
          <button type="button" class="min-w-0 text-left font-medium" onclick={onToggle}><FadeText text={row.title} /></button>
        {/if}
        {#if row.processes.length > 1}<span class="stamp shrink-0 text-meta text-muted-foreground">{row.processes.length}</span>{/if}
        {#if ending !== null}
          <span
            class={['shrink-0 text-meta', ending.failed ? 'text-destructive' : 'text-muted-foreground']}
            role="status"
            title={ending.hint}>{ending.text}</span
          >
        {/if}
      </span>
      {#if detail !== ''}
        <FadeText class="text-meta text-muted-foreground" text={detail} />
      {/if}
    </span>
    <span class={CELLS}>
      <LoadSpark points={sparkOf(history, row.key)} {end} />
      <span class={FIGURE} title={partial}>{partial === undefined ? '' : '≥'}{percent(row.share)}</span>
      {#if gpu}{@const used = rowGpu(row)}<span class={[FIGURE, 'text-muted-foreground']} title={used.hint}>{used.text}</span>{/if}
      <span class={MEMORY}>{formatBytes(row.memoryBytes)}</span>
    </span>
    {@render gutter(view.stoppable(row) ? () => void view.stop(row) : null, stopWords(row), stopping, !agent)}
  </div>
  {#each processes as one (one.pid)}
    {@render processRow(one)}
  {/each}
</div>
