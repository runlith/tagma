<script lang="ts" generics="T extends Found">
  import type { Snippet } from 'svelte';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { placeSaid } from '@tagma/server/enforcement/contract/wire/findings';
  import CodeText from '$lib/shared/CodeText.svelte';
  import type { Link } from '$lib/features/opening/Link.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { timeCompact } from '$lib/shared/time.js';
  import Disclosure from '$lib/shared/ui/Disclosure.svelte';
  import { cn } from '$lib/shared/utils.js';
  import type { Found } from './found.js';
  import { RECENT_MS } from './words.js';

  let {
    rows,
    total,
    more,
    initial = Number.POSITIVE_INFINITY,
    now,
    general = null,
    detail,
    essence,
    figure,
    link,
  }: {
    rows: readonly T[];
    total: number;
    more: (() => void) | null;
    initial?: number;
    now: number;
    general?: string | null;
    detail?: Snippet<[T]>;
    essence?: Snippet<[T]>;
    figure?: Snippet<[T]>;
    link?: (file: string, line: number | null) => Link;
  } = $props();

  const opening = Opening.use();
  const here = App.current();

  const STEP = 50;

  let grown = $state(0);

  const visible = $derived(rows.slice(0, initial + grown));
  const left = $derived(Math.max(0, total - visible.length));
  const timed = $derived(rows.some((row) => row.at !== null));
  const columns = $derived(
    timed ? 'grid-cols-[0.875rem_2.25rem_minmax(0,5fr)_minmax(0,7fr)_2.5rem]' : 'grid-cols-[0.875rem_minmax(0,5fr)_minmax(0,7fr)_2.5rem]',
  );

  function showMore(): void {
    const wanted = visible.length + STEP;
    if (Number.isFinite(initial)) grown = wanted - initial;
    if (wanted > rows.length) more?.();
  }

  const exact = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

{#snippet place(row: T)}
  {#if row.file !== null}
    <PathText
      path={row.file}
      suffix={row.line === null ? '' : `:${row.line}`}
      class={cn('font-mono', row.said === null && essence === undefined && 'col-span-2')}
      title={placeSaid({ file: row.file, line: row.line ?? undefined })}
      nameClass="text-foreground/90"
      directoryClass="text-muted-foreground"
    />
  {/if}
{/snippet}

<div class="grid min-w-0 grid-cols-[minmax(0,1fr)] divide-y divide-vein border-y border-vein">
  {#each visible as row (row.key)}
    <Disclosure
      class="min-w-0"
      summaryClass={cn('grid h-7 w-full min-w-0 items-center gap-x-3 rounded-none px-2 text-small hover:bg-hover', columns)}
    >
      {#snippet summary()}
        {#if timed}
          <span
            class={cn(
              'text-right tabular-nums',
              row.at !== null && now - Date.parse(row.at) < RECENT_MS ? 'text-severity-lie' : 'text-muted-foreground',
            )}
            title={row.at === null ? undefined : exact(row.at)}>{row.at === null ? '' : timeCompact(row.at, now)}</span
          >
        {/if}
        {#if row.file !== null}
          {@render place(row)}
        {:else if essence}
          <FadeText fade="start" class="font-mono text-muted-foreground" title={row.said ?? undefined} text={row.said ?? ''} />
        {/if}
        {#if essence}
          <span class="min-w-0">{@render essence(row)}</span>
        {:else if row.said !== null}
          <FadeText class={cn('text-muted-foreground', row.file === null && 'col-span-2')}
            ><CodeText text={row.said} codeClass="text-foreground/80" /></FadeText
          >
        {:else if row.file === null}
          <span class="col-span-2"></span>
        {/if}
        <span class="text-right text-muted-foreground tabular-nums">
          {#if figure}{@render figure(row)}{:else if row.times > 1}×{row.times}{/if}
        </span>
      {/snippet}
      <div class={cn('grid gap-x-3 px-2 pt-1 pb-3 text-small', columns)}>
        <div class={cn('grid min-w-0 gap-1.5', timed ? 'col-span-3 col-start-3' : 'col-span-3 col-start-2')}>
          {#if row.file !== null}
            {@const file = row.file}
            {@const where = placeSaid({ file, line: row.line ?? undefined })}
            {#if link}
              <button
                type="button"
                class="group/open w-fit text-left font-mono break-all text-muted-foreground hover:text-foreground"
                {@attach linkTarget(opening, () => link(file, row.line), here)}
                >{where}<ArrowUpRight class="ml-1 inline size-3 align-baseline opacity-60 group-hover/open:opacity-100" /></button
              >
            {:else}
              <p class="font-mono break-all text-muted-foreground">{where}</p>
            {/if}
          {/if}
          {#if row.said !== null}
            <p class="leading-relaxed break-words text-foreground/90"><CodeText text={row.said} /></p>
          {/if}
          {#if row.fix !== null || general !== null}
            <p class="leading-relaxed break-words text-muted-foreground">
              <span class="text-foreground/80">Fix</span>
              <CodeText text={row.fix ?? general ?? ''} />
            </p>
          {/if}
          {#if detail}
            <div class="leading-relaxed text-muted-foreground">{@render detail(row)}</div>
          {/if}
        </div>
      </div>
    </Disclosure>
  {/each}
</div>
{#if left > 0 && (visible.length < rows.length || more !== null)}
  <button type="button" class="mt-1 px-2 py-1 text-ui text-muted-foreground hover:text-foreground" onclick={showMore}>
    Show {Math.min(STEP, left)} more <span class="text-muted-foreground/70 tabular-nums">of {left}</span>
  </button>
{/if}
