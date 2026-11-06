<script lang="ts">
  import Activity from '@lucide/svelte/icons/activity';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { HoverIntent } from '@runlith/primitives/popover.svelte';
  import { loadInStatusBar } from '@tagma/server/executions/contract/wire/load';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { Readings } from '$lib/features/executions/load/Readings.svelte.js';
  import { backgroundShare, percent, totalMemory, totalShare } from '$lib/features/executions/load/rows.js';
  import { View } from '$lib/features/executions/load/View.svelte.js';
  import { UserSettings } from '$lib/features/settings/UserSettings.svelte.js';
  import LoadGlance from './LoadGlance.svelte';
  import LoadPanel from './LoadPanel.svelte';
  import LoadPlot from './LoadPlot.svelte';

  const HOVER: HoverIntent = { openMs: 400, closeMs: 300 };
  const RING = 2 * Math.PI * 5;

  const readings = Readings.use();
  const view = View.use();
  const wanted = UserSettings.use().of(loadInStatusBar);

  $effect(() => readings.hold());

  const shown = $derived(wanted.value);

  let glancing = $state(false);
  let mode = $state<'glance' | 'panel'>('glance');
  const open = $derived(view.open || glancing);

  $effect.pre(() => {
    if (view.open) mode = 'panel';
    else if (glancing) mode = 'glance';
  });
  $effect.pre(() => {
    if (!shown) glancing = false;
  });

  const loaded = $derived(readings.view);
  const live = $derived(readings.silent === null);
  const history = $derived(readings.history);
  const background = $derived(loaded?.background ?? []);
  const progress = $derived(background.length === 0 ? null : backgroundShare(background));

  function change(next: boolean): void {
    if (next) {
      glancing = true;
      return;
    }
    glancing = false;
    view.show(false);
  }

  function expand(thread: string | null): void {
    glancing = false;
    if (thread === null) view.show(true);
    else view.reveal(thread);
  }
</script>

<Popover.Root {open} onOpenChange={change}>
  {#if shown}
    <Popover.Trigger
      hover={HOVER}
      class="flex min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 tabular-nums transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground"
      aria-label="Load of Tagma and its agents"
      data-load-button
      onclick={() => {
        if (open) expand(null);
      }}
    >
      {#if live && background.length > 0}
        {#if progress === null}
          <Waiting class="size-3 text-muted-foreground" />
        {:else}
          <svg class="size-3 shrink-0" viewBox="0 0 12 12" aria-hidden="true" data-load-progress>
            <circle cx="6" cy="6" r="5" fill="none" stroke="var(--vein-strong)" stroke-width="1.5" />
            <circle
              cx="6"
              cy="6"
              r="5"
              fill="none"
              class="stroke-brand"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-dasharray="{RING * progress} {RING}"
              transform="rotate(-90 6 6)"
            />
          </svg>
        {/if}
      {/if}
      {#if history.length < 2}
        <Activity class="size-3.5" />
      {:else}
        <LoadPlot class={['h-3.5 w-9 shrink-0', live ? '' : 'opacity-40']} {history} layers={[]} lit={null} top={1} />
      {/if}
      {#if loaded === null}
        <span data-load-unknown>—</span>
      {:else}
        <span class={['flex items-center gap-2 whitespace-nowrap', live ? '' : 'opacity-40']} data-load-figures>
          <span
            ><span>{totalShare(loaded.totals.own)}</span><span
              class={live && loaded.saturated ? 'text-status-in-work' : 'text-muted-foreground'}
              data-load-machine>/{percent(loaded.share)}</span
            ></span
          >
          <span class={live && readings.pressed !== null ? 'text-status-in-work' : ''} data-load-memory-figure
            >{totalMemory(loaded.totals.own)}</span
          >
        </span>
      {/if}
    </Popover.Trigger>
  {:else}
    <Popover.Trigger class="block size-0 shrink-0 overflow-hidden p-0" tabindex={-1} aria-hidden="true" data-load-anchor />
  {/if}
  <Popover.Content
    side="top"
    align="end"
    sideOffset={6}
    collisionPadding={12}
    class={cn(
      'max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0',
      mode === 'panel' ? 'w-[28rem]' : 'max-h-(--float-available-height) w-96',
    )}
  >
    {#if mode === 'panel'}
      <LoadPanel onClose={() => change(false)} />
    {:else}
      <LoadGlance onOpen={expand} />
    {/if}
  </Popover.Content>
</Popover.Root>
