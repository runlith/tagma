<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Search from '@lucide/svelte/icons/search';
  import { Popover } from '@runlith/primitives/popover.svelte';
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { Readings, silentWords } from '$lib/features/executions/load/Readings.svelte.js';
  import {
    idleTotal,
    layersOf,
    listing,
    litOf,
    totalMemory,
    totalShare,
    totalUnread,
    unresolvedWords,
    type Order,
    type Shown,
  } from '$lib/features/executions/load/rows.js';
  import { View } from '$lib/features/executions/load/View.svelte.js';
  import { onLinkOpened } from '$lib/features/opening/linkTarget.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import LoadBackground from './LoadBackground.svelte';
  import LoadChart from './LoadChart.svelte';
  import LoadFigures from './LoadFigures.svelte';
  import LoadRow from './LoadRow.svelte';
  import PaceControl from './PaceControl.svelte';
  import PaceProblem from './PaceProblem.svelte';

  let { onClose }: { onClose: () => void } = $props();

  const popover = Popover.use();
  $effect(() => untrack(() => popover.hold()));

  const readings = Readings.use();
  const view = View.use();
  const clock = WallClock.use();

  let order = $state<Order>('cpu');
  let query = $state('');
  let lit = $state<string | null>(null);
  let outsideOpen = $state(false);
  let othersOpen = $state(false);
  let idleOpen = $state(false);
  let flashed = $state<string | null>(null);
  let body = $state<HTMLDivElement | null>(null);
  const opened = new SvelteSet<string>();

  $effect(() => clock.watch());

  const loaded = $derived(readings.view);
  const now = $derived(clock.now);
  const history = $derived(readings.history);
  const end = $derived(history.at(-1)?.at ?? loaded?.readAt ?? now);
  const listed = $derived(loaded === null ? null : listing(loaded, order, query));
  const layers = $derived(loaded === null ? [] : layersOf(loaded));
  const tones = $derived(new Map(layers.map((layer) => [layer.key, layer])));
  const lighted = $derived(loaded === null ? null : litOf(loaded, layers, lit));
  const searching = $derived(query.trim() !== '');
  const outsideShown = $derived(searching || outsideOpen);
  const silent = $derived(readings.silent);
  const standing = $derived(
    new Set(loaded === null ? [] : loaded.rows.flatMap((row) => [row.key, ...row.processes.map((one) => `${row.key}/${one.pid}`)])),
  );
  const departed = $derived(view.departed(standing, now));
  const nothing = $derived(listed !== null && listed.own.length + listed.idle.length + listed.outside.length === 0);
  const idle = $derived(listed === null ? null : idleTotal(listed.idle));
  const unresolved = $derived(loaded === null ? undefined : unresolvedWords(loaded));

  $effect(() => readings.demandOthers(outsideShown));
  $effect(() => () => untrack(() => readings.demandOthers(false)));

  $effect(() => {
    const aimed = view.aimed;
    const rows = loaded?.rows;
    if (aimed === null || rows === undefined || body === null) return;
    const row = rows.find((one) => one.thread === aimed);
    if (row === undefined) return;
    untrack(() => {
      query = '';
      opened.add(row.key);
      flashed = row.key;
      view.aimed = null;
    });
    void tick().then(() => {
      body?.querySelector<HTMLElement>(`[data-load-row="${CSS.escape(row.key)}"]`)?.scrollIntoView({ block: 'center' });
      setTimeout(() => {
        if (flashed === row.key) flashed = null;
      }, 1600);
    });
  });

  function toggle(key: string): void {
    if (opened.has(key)) opened.delete(key);
    else opened.add(key);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (query !== '' && event.target instanceof HTMLInputElement) query = '';
      else onClose();
      return;
    }
    if (body === null || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    const options = [...body.querySelectorAll<HTMLElement>('[data-load-option]')];
    if (options.length === 0) return;
    const at = options.indexOf(document.activeElement as HTMLElement);
    const next = options[Math.max(0, Math.min(options.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    event.preventDefault();
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  }

  const HEAD = 'flex items-center justify-end gap-0.5 text-meta hover:text-foreground';
  const FIGURE = 'stamp w-12 shrink-0 text-right tabular-nums';
  const MEMORY = 'stamp w-16 shrink-0 text-right tabular-nums';
</script>

{#snippet sortBy(key: Order, label: string, width: string)}
  <button
    type="button"
    class={[HEAD, width, order === key ? 'font-semibold text-foreground' : '']}
    aria-pressed={order === key}
    onclick={() => (order = key)}
    >{label}{#if order === key && key !== 'name'}<ArrowDown class="size-3" />{/if}</button
  >
{/snippet}

{#snippet row(shown: Shown)}
  <LoadRow
    {shown}
    layer={tones.get(shown.row.key)}
    {history}
    {end}
    {now}
    open={opened.has(shown.row.key)}
    flash={flashed === shown.row.key}
    onToggle={() => toggle(shown.row.key)}
    onLit={(key) => (lit = key)}
  />
{/snippet}

{#snippet background()}
  {#if loaded !== null && loaded.background.length > 0}
    <div
      class="flex h-6 items-center gap-2 border-t border-border bg-sunken pr-2 pl-8 text-meta text-muted-foreground"
      data-load-group="background"
    >
      <FadeText class="flex-1"
        ><span class="font-medium text-foreground">Background work</span>
        <span class="stamp">{loaded.background.length}</span></FadeText
      >
    </div>
    {#each loaded.background as work (work.id)}
      <LoadBackground {work} class="border-t border-vein py-2 pr-3 pl-8" />
    {/each}
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex h-[min(36rem,calc(100dvh-5rem))] min-h-0 flex-col text-small"
  onkeydown={onKey}
  data-load-panel
  {@attach onLinkOpened(onClose)}
>
  <header class="grid gap-2 px-3 pt-3 pb-2">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span class="text-meta text-muted-foreground">Tagma and its agents</span>
      <PaceControl />
    </div>
    <PaceProblem />
    <LoadFigures />
    <LoadChart {history} {layers} lit={lighted} />
    {#if silent !== null}
      <p class="text-meta text-status-in-work" role="status" data-load-banner={silent._tag}>{silentWords(silent, now)}</p>
    {:else if loaded?.unread !== undefined}
      <FadeText class="text-meta text-muted-foreground" title={loaded.unread} text="Part of this reading was not read: {loaded.unread}" />
    {/if}
    {#if silent === null && unresolved !== undefined}
      <FadeText class="text-meta text-muted-foreground" title={unresolved} text={unresolved.split('\n')[0]} data-load-unresolved />
    {/if}
    {#each departed as one (one.key)}
      <FadeText
        class={['text-meta', one.failed ? 'text-destructive' : 'text-muted-foreground']}
        role="status"
        title={one.hint}
        data-load-departed={one.key}
        text="{one.title}: {one.text}"
      />
    {/each}
  </header>

  <div class="flex items-center gap-2 border-t border-border px-3 py-2">
    <label class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-field px-2 py-1">
      <Search class="size-3.5 shrink-0 text-muted-foreground" />
      <input
        class="min-w-0 flex-1 bg-transparent text-small outline-none"
        placeholder="Name, page, command or PID"
        aria-label="Find an agent, page, view, command, program or process"
        bind:value={query}
      />
    </label>
  </div>

  <div class="flex h-6 items-center gap-2 border-y border-border bg-sunken pr-2 pl-8 text-muted-foreground">
    <button
      type="button"
      class={['flex-1 text-left text-meta hover:text-foreground', order === 'name' ? 'font-semibold text-foreground' : '']}
      aria-pressed={order === 'name'}
      onclick={() => (order = 'name')}>Name</button
    >
    <span class="w-14 shrink-0"></span>
    {@render sortBy('cpu', 'CPU', 'w-12')}
    {@render sortBy('memory', 'Memory', 'w-16')}
    <span class="w-5 shrink-0"></span>
  </div>

  <div bind:this={body} class={['min-h-0 flex-1 overflow-y-auto overscroll-contain', silent !== null ? 'opacity-60' : '']} data-load-list>
    {#if listed === null || loaded === null}
      <p class="px-3 py-4 text-center text-muted-foreground">{silent === null ? 'Reading the machine…' : silentWords(silent, now)}</p>
    {:else if nothing}
      <p class="px-3 py-4 text-center text-muted-foreground" data-load-nothing>Nothing matches.</p>
    {:else}
      {#each listed.own as one (one.row.key)}
        {@render row(one)}
        {#if !searching && one.row.kind === 'server'}{@render background()}{/if}
      {/each}
      {#if idle !== null && idle.count > 0}
        <div class="border-t border-vein" data-load-idle>
          <button
            type="button"
            class="flex min-h-8 w-full items-center gap-2 pr-2 pl-2 text-left text-muted-foreground hover:bg-hover"
            aria-expanded={idleOpen}
            data-load-option
            onclick={() => (idleOpen = !idleOpen)}
          >
            <span class="grid size-4 shrink-0 place-items-center"
              ><ChevronRight class={['size-3 transition-transform', idleOpen ? 'rotate-90' : '']} /></span
            >
            <FadeText class="flex-1" text="Idle — {idle.count}" />
            <span class="w-14 shrink-0"></span>
            <span class={FIGURE} title={totalUnread(idle)}>{totalShare(idle)}</span>
            <span class={MEMORY}>{totalMemory(idle)}</span>
            <span class="w-5 shrink-0"></span>
          </button>
          {#if idleOpen}
            {#each listed.idle as one (one.row.key)}
              {@render row(one)}
              {#if one.row.kind === 'server'}{@render background()}{/if}
            {/each}
          {/if}
        </div>
      {/if}
      {#if !searching || listed.outside.length > 0}
        <div class="border-t border-border" data-load-outside>
          <button
            type="button"
            class="flex min-h-8 w-full items-center gap-2 pr-2 pl-2 text-left hover:bg-hover"
            aria-expanded={outsideShown}
            data-load-option
            onclick={() => (outsideOpen = !outsideOpen)}
          >
            <span class="grid size-4 shrink-0 place-items-center text-muted-foreground"
              ><ChevronRight class={['size-3 transition-transform', outsideShown ? 'rotate-90' : '']} /></span
            >
            <span class="flex min-w-0 flex-1 flex-col py-1">
              <FadeText class="font-medium" text="Rest of the {loaded.machine}" />
              <FadeText class="text-meta text-muted-foreground" text="Other programs and the system" />
            </span>
            <span class="w-14 shrink-0"></span>
            <span class={FIGURE} title={totalUnread(loaded.totals.outside)}>{totalShare(loaded.totals.outside)}</span>
            <span class={[MEMORY, 'text-muted-foreground']}>{totalMemory(loaded.totals.outside)}</span>
            <span class="w-5 shrink-0"></span>
          </button>
          {#if outsideShown}
            {#each listed.outside as one (one.row.key)}
              {@render row(one)}
            {/each}
            {#if listed.others !== null}
              <div class="border-t border-vein" data-load-rest>
                <button
                  type="button"
                  class="flex min-h-8 w-full items-center gap-2 pr-2 pl-2 text-left text-muted-foreground hover:bg-hover"
                  aria-expanded={othersOpen}
                  data-load-option
                  onclick={() => (othersOpen = !othersOpen)}
                >
                  <span class="grid size-4 shrink-0 place-items-center"
                    ><ChevronRight class={['size-3 transition-transform', othersOpen ? 'rotate-90' : '']} /></span
                  >
                  <FadeText class="flex-1" text="Others — {listed.others.count}, each under half a percent" />
                  <span class="w-14 shrink-0"></span>
                  <span class={FIGURE} title={totalUnread(listed.others)}>{totalShare(listed.others)}</span>
                  <span class={MEMORY}>{totalMemory(listed.others)}</span>
                  <span class="w-5 shrink-0"></span>
                </button>
                {#if othersOpen}
                  {#each listed.minor as one (one.row.key)}
                    {@render row(one)}
                  {/each}
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
