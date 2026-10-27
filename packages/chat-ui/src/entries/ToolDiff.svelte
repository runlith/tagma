<script lang="ts">
  import { elementScroll, observeElementOffset, observeElementRect, Virtualizer, type VirtualItem } from '@tanstack/virtual-core';
  import { untrack } from 'svelte';
  import type { PatchHunk } from '@runlith/utils/patch';
  import { type DiffColours, type DiffHighlight, diffPieces } from './diffPieces';
  import DiffRow from './DiffRow.svelte';
  import { diffState, patchIdentity } from './diffState';
  import { gutterDigits, type PatchRow, patchRows, patchText } from './patchRows';

  let {
    patch,
    path = null,
    language,
    highlight,
    binary = false,
    timedOut = false,
    wrap = false,
  }: {
    patch: string | readonly PatchHunk[];
    path?: string | null;
    language?: string;
    highlight?: DiffHighlight;
    binary?: boolean;
    timedOut?: boolean;
    wrap?: boolean;
  } = $props();

  const WASH = { added: 'bg-chat-diff-added/12', removed: 'bg-chat-diff-removed/12', context: '' } as const;
  const INK = {
    added: 'text-chat-diff-added',
    removed: 'text-chat-diff-removed',
    context: 'text-muted-foreground',
  } as const;
  const SIGN = { added: '+', removed: '−', context: ' ' } as const;
  const SIGN_INK = {
    added: 'text-chat-diff-added',
    removed: 'text-chat-diff-removed',
    context: 'text-transparent',
  } as const;

  const ROW_PX = 20;
  const OVERSCAN_ROWS = 20;

  const identity = $derived(patchIdentity(patch, path));
  let asked = $state<string | null>(null);

  const chain = $derived(diffState({ patch, binary, timedOut, asked: asked === identity }));
  const hunks = $derived(chain.kind === 'rows' || chain.kind === 'partial' ? chain.hunks : []);
  const rows = $derived(patchRows(hunks));
  const digits = $derived(gutterDigits(hunks));
  const code = $derived(patchText(rows));

  let coloured = $state<DiffColours | undefined>();

  let widest = $state(0);

  let scroller: HTMLElement | undefined = $state();
  let virtualizer = $state<Virtualizer<HTMLElement, HTMLElement> | undefined>();
  let mounted = $state<readonly VirtualItem[]>([]);
  let total = $state(0);

  const asker = $props.id();

  $effect(() => {
    const ask = highlight;
    const text = code;
    const spoken = language;
    coloured = undefined;
    if (ask === undefined || text.length === 0) return;
    let live = true;
    void ask(text, spoken, asker)
      .then((lines) => {
        if (live && lines !== undefined) coloured = lines;
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  });

  function options(element: HTMLElement) {
    return {
      count: rows.length,
      getScrollElement: () => element,
      estimateSize: () => ROW_PX,
      getItemKey: (index: number) => rows[index]?.key ?? index,
      overscan: OVERSCAN_ROWS,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: () => schedulePublish(),
    };
  }

  function publish(): void {
    const made = virtualizer;
    if (made === undefined) return;
    mounted = made.getVirtualItems();
    total = made.getTotalSize();
  }

  let publishing = false;

  function schedulePublish(): void {
    if (publishing) return;
    publishing = true;
    queueMicrotask(() => {
      publishing = false;
      publish();
    });
  }

  function measure(node: HTMLElement): void {
    virtualizer?.measureElement(node);
    const span = spanOf(node);
    if (span > widest) widest = span;
  }

  function spanOf(node: HTMLElement): number {
    const first = node.firstElementChild;
    const last = node.lastElementChild;
    if (!(first instanceof HTMLElement)) return 0;
    return last instanceof HTMLElement && last !== first ? first.offsetWidth + last.scrollWidth : first.scrollWidth;
  }

  $effect(() => {
    const element = scroller;
    if (element === undefined) return;
    const made = new Virtualizer(untrack(() => options(element)));
    const release = made._didMount();
    virtualizer = made;
    return () => {
      release();
      virtualizer = undefined;
      mounted = [];
      total = 0;
    };
  });

  $effect(() => {
    identity;
    widest = 0;
  });

  $effect(() => {
    wrap;
    const made = untrack(() => virtualizer);
    const element = untrack(() => scroller);
    if (made === undefined || element === undefined) return;
    queueMicrotask(() => {
      made.measure();
      for (const node of element.querySelectorAll<HTMLElement>('[data-index]')) made.measureElement(node);
    });
  });

  $effect(() => {
    const made = virtualizer;
    const element = scroller;
    if (made === undefined || element === undefined) return;
    made.setOptions(options(element));
    made._willUpdate();
    publish();
  });
</script>

{#snippet named()}
  {#if path !== null}
    <p class="font-mono text-small break-all text-muted-foreground/60">{path}</p>
  {/if}
{/snippet}

{#snippet text(row: Extract<PatchRow, { kind: 'line' }>)}
  {#each diffPieces(row.line.text, coloured?.get(row.at), row.line.spans) as piece, index (index)}
    <span class={piece.marked ? WASH[row.line.kind] : undefined} style={piece.color === undefined ? undefined : `color:${piece.color}`}
      >{piece.text}</span
    >
  {/each}
{/snippet}

<div class="flex h-full min-h-0 w-full min-w-0 flex-col">
  {#if chain.kind === 'binary'}
    <p class="p-3 text-ui text-muted-foreground">git counts no lines in this file: its content is binary.</p>
  {:else if chain.kind === 'identical'}
    <p class="p-3 text-ui text-muted-foreground">The working file is what HEAD carries.</p>
  {:else if chain.kind === 'oversized'}
    <div class="grid gap-1 p-3 text-ui text-muted-foreground">
      <p>Too large to draw: more than {chain.atLeast.toLocaleString()} lines.</p>
      {@render named()}
    </div>
  {:else if chain.kind === 'unmeasured'}
    <div class="grid justify-items-start gap-2 p-3 text-ui text-muted-foreground">
      <p>This patch is longer than the reader measures, so its lines were never counted.</p>
      {@render named()}
      <button
        type="button"
        class="cursor-pointer rounded-md border border-border bg-background/65 px-3 py-1 text-small font-semibold text-foreground transition hover:bg-hover"
        onclick={() => (asked = identity)}>Draw it anyway</button
      >
    </div>
  {:else if chain.kind === 'deferred'}
    <div class="grid justify-items-start gap-2 p-3 text-ui text-muted-foreground">
      <p>{chain.lines.toLocaleString()} lines — more than this reader draws unasked.</p>
      {@render named()}
      <button
        type="button"
        class="cursor-pointer rounded-md border border-border bg-background/65 px-3 py-1 text-small font-semibold text-foreground transition hover:bg-hover"
        onclick={() => (asked = identity)}>Draw them</button
      >
    </div>
  {:else}
    {#if chain.kind === 'partial'}
      <p class="shrink-0 border-b border-border/50 bg-hover px-2 py-1 text-small text-muted-foreground/70">
        The comparison could not finish, so these rows are aligned only in part.
      </p>
    {/if}
    <div class="@container/diff flex min-h-0 w-full min-w-0 flex-1">
      <div bind:this={scroller} class="min-h-0 min-w-0 flex-1 overflow-auto font-mono text-small leading-5 [tab-size:4]">
        <div class="relative" style={wrap ? `height:${total}px;width:100%` : `height:${total}px;min-width:100%;width:${widest}px`}>
          {#each mounted as item (item.key)}
            {@const row = rows[item.index]}
            {#if row?.kind === 'break'}
              <DiffRow
                index={item.index}
                top={item.start}
                class="flex h-5 items-center border-y border-border/50 bg-hover text-meta leading-none text-muted-foreground/60"
                {measure}
                {wrap}
              >
                <span class="sticky left-0 flex items-center gap-2 px-2">
                  <span>{row.hiddenBefore === 0 ? '⋯' : `${row.hiddenBefore.toLocaleString()} unchanged lines`}</span>
                </span>
              </DiffRow>
            {:else if row}
              <DiffRow index={item.index} top={item.start} class={`flex items-baseline ${WASH[row.line.kind]}`} {measure} {wrap}>
                <span class="sticky left-0 z-10 flex shrink-0 items-baseline gap-x-2 bg-chat-sunken px-2 select-none">
                  <span
                    class={['text-right', row.line.after === null ? 'text-chat-diff-removed/40' : 'text-muted-foreground/35']}
                    style={`width:${digits}ch`}>{row.line.after ?? row.line.before ?? ''}</span
                  >
                  <span class={['w-[1ch]', SIGN_INK[row.line.kind]]}>{SIGN[row.line.kind]}</span>
                </span>
                <span
                  class={[
                    wrap ? 'min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre',
                    'pr-2',
                    INK[row.line.kind],
                  ]}>{@render text(row)}</span
                >
              </DiffRow>
            {/if}
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
