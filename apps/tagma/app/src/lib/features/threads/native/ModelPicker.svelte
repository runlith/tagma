<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import InlineSvg from '$lib/shared/ui/InlineSvg.svelte';
  import type { ModelPanelState } from '../ModelPanelState.svelte.js';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import ModelSummary from './ModelSummary.svelte';

  let { views, panel }: { views: ThreadViews; panel: ModelPanelState } = $props();

  const settings = $derived(views.model.settings);
  const open = $derived(panel.current?.mode === 'model');
  const lit = $derived(
    (settings?.switches ?? []).flatMap((option) =>
      option.icon !== undefined && option.values.length === 2 && option.value === option.values[1]?.id
        ? [{ id: option.id, label: option.label, icon: option.icon }]
        : [],
    ),
  );

  const PILL =
    'inline-flex h-6 pointer-coarse:h-8 min-w-0 shrink items-center gap-1 rounded-md px-1.5 text-meta font-medium text-foreground/80 transition-colors hover:bg-hover hover:text-foreground disabled:opacity-60 @min-[30rem]:h-7 @min-[30rem]:gap-1.5 @min-[30rem]:px-2 @min-[30rem]:text-small';
</script>

{#if settings}
  <button
    type="button"
    class={[PILL, open && 'bg-selected text-foreground']}
    aria-label="Model and reasoning"
    aria-expanded={open}
    data-panel-door
    disabled={settings.busy}
    onpointerdown={(event) => event.preventDefault()}
    onclick={() => (open ? panel.close() : panel.open('model'))}
  >
    <ModelSummary {settings} />
    {#each lit as option (option.id)}
      <InlineSvg svg={option.icon} label={option.label} class="size-3" />
    {/each}
    <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
  </button>
{/if}
