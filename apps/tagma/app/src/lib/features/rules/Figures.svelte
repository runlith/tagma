<script lang="ts">
  import type { AnsweredFigure, UnitRow } from '@tagma/server/enforcement/contract/wire/engines';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Modules from './Modules.svelte';

  let {
    figures,
    units,
    unitsTotal,
    more,
    onfocus,
  }: {
    figures: readonly AnsweredFigure[];
    units: readonly UnitRow[];
    unitsTotal: number;
    more: (() => void) | null;
    onfocus: (module: string) => void;
  } = $props();

  const FOLDED = 18;

  let open = $state<ReadonlySet<string>>(new Set());

  const unfold = (label: string): void => {
    open = new Set([...open, label]);
  };
</script>

<div class="grid gap-4">
  {#each figures as figure, at (at)}
    {#if figure.kind === 'modules'}
      <Modules modules={figure.modules} relations={figure.relations} focus={figure.focus} {units} {unitsTotal} {more} {onfocus} />
    {:else if figure.kind === 'thresholds'}
      {@const [first, ...rest] = figure.thresholds}
      {#if first}
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-title leading-none font-semibold tabular">{first.lines}</span>
          <span class="text-ui text-muted-foreground">
            {first.metric === 'non-import' ? 'lines outside import statements' : first.metric} at most{first.glob === '**'
              ? ''
              : ` in ${first.glob}`}
          </span>
        </div>
      {/if}
      {#if rest.length > 0}
        <div class="grid gap-1 text-ui">
          {#each rest as one (one.glob)}
            <div class="flex min-w-0 items-baseline gap-2">
              <span class="stamp min-w-0 truncate">{one.glob}</span>
              <span class="shrink-0 tabular">{one.lines}</span>
              {#if one.why}<span class="min-w-0 truncate text-small text-muted-foreground">{one.why}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else if figure.kind === 'lists'}
      <div class="grid gap-3">
        {#each figure.lists as list (list.label)}
          {@const shown = open.has(list.label) ? list.items : list.items.slice(0, FOLDED)}
          <div>
            <div class="text-small text-muted-foreground">{list.label} <span class="tabular">({list.items.length})</span></div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              {#each shown as item, n (n)}
                <span class="stamp rounded-sm border border-vein bg-raised px-1.5 py-0.5 text-meta break-all">{item}</span>
              {:else}
                <span class="text-small text-muted-foreground/70">none</span>
              {/each}
              {#if list.items.length > shown.length}
                <button type="button" class="text-small text-muted-foreground hover:text-foreground" onclick={() => unfold(list.label)}>
                  +{list.items.length - shown.length} more
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else if figure.kind === 'counts'}
      {@const most = Math.max(1, ...figure.counts.map((one) => one.count))}
      <div>
        <div class="text-small text-muted-foreground">{figure.label}</div>
        <div class="mt-1.5 grid gap-0.5">
          {#each figure.counts as one (one.name)}
            <div class="grid grid-cols-[minmax(8rem,16rem)_1fr_2.5rem] items-center gap-2 text-small">
              <FadeText fade="start" class="stamp text-right" title={one.name} text={one.name} />
              <span class="h-1.5 rounded-full bg-status-none/25">
                <span class="block h-full rounded-full bg-status-none" style:width={`${(one.count / most) * 100}%`}></span>
              </span>
              <span class="tabular text-muted-foreground">{one.count}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/each}
</div>
