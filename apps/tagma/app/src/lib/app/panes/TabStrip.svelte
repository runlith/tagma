<script lang="ts">
  import { type LinkStep, Opening } from '$lib/features/opening/Opening.svelte.js';
  import TabRail from '$lib/shared/TabRail.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import PanelIcon from '$lib/shared/ui/PanelIcon.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { Keymap } from '../keys/Keymap.svelte.js';
  import NewTab from './NewTab.svelte';
  import { SidePanes } from './SidePanes.svelte.js';

  let { class: className }: { class?: string } = $props();

  const panes = SidePanes.use();
  const opening = Opening.use();
  const keymap = Keymap.use();
  const chord = $derived(keymap.spell('area.toggle'));

  const active = $derived(panes.active);
  const expanding = $derived.by((): readonly { readonly tab: SidePane; readonly full: LinkStep }[] => {
    const full = active === null || panes.app === null ? null : opening.tabbed(active, panes.app);
    return active === null || full === null ? [] : [{ tab: active, full }];
  });

  function expand(tab: SidePane, full: LinkStep): void {
    if (panes.kinds.find(tab.kind)?.moves === true) panes.close(tab.key);
    void full.run();
  }
</script>

{#snippet face(tab: SidePane)}
  {@const Title = panes.kinds.declared(tab.kind).title}
  <span class="flex min-w-0 flex-1 items-center gap-1.5" data-tab-kind={tab.kind}><Title pane={tab} /></span>
  {#if tab.agent}
    <span class="size-1.5 shrink-0 bg-status-in-work" role="img" aria-label="An agent drives it"></span>
  {/if}
{/snippet}

{#snippet after()}
  <NewTab />
{/snippet}

{#snippet end()}
  {#each expanding as one (one.tab.key)}
    {@const Icon = one.full.icon}
    <Tooltip text={one.full.words}>
      <Button
        variant="quiet"
        size="icon-sm"
        class="no-drag-region self-center"
        aria-label={one.full.words}
        onclick={() => expand(one.tab, one.full)}
        data-pane-full={one.tab.kind}
      >
        <Icon class="size-3.5" />
      </Button>
    </Tooltip>
  {/each}
  <Tooltip text="Hide tabs" keys={chord}>
    <Button variant="quiet" size="icon-sm" class="no-drag-region self-center" aria-label="Hide tabs" onclick={() => panes.showArea(false)}>
      <PanelIcon side="right" class="size-3.5" />
    </Button>
  </Tooltip>
{/snippet}

<TabRail
  class={['h-full flex-1 pl-1.5', className].filter(Boolean).join(' ')}
  items={panes.panes}
  key={(tab) => tab.key}
  active={panes.layout.active}
  label="Tabs beside"
  name={(tab) => panes.kinds.declared(tab.kind).noun}
  activate={(id) => panes.activate(id)}
  close={(id) => panes.close(id)}
  move={(id, before) => panes.move(id, before)}
  tab={face}
  {after}
  {end}
/>
