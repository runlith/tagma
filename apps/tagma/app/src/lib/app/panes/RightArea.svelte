<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { Seam } from '@runlith/seam/Seam.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { untrack } from 'svelte';
  import { AreaFrame } from './AreaFrame.svelte.js';
  import PaneStack from './PaneStack.svelte';
  import { AREA_SEAM } from './seams.js';
  import { SidePanes } from './SidePanes.svelte.js';
  import { TabLayouts } from './TabLayouts.svelte.js';

  const panes = SidePanes.use();
  const frame = AreaFrame.use();
  const layouts = TabLayouts.use();
  const app = App.current();

  $effect(() => panes.attach(layouts, app));

  const activeKey = $derived(panes.active?.key ?? null);

  const seam = $derived.by(() => {
    const size = frame.width;
    return untrack(
      () =>
        new Seam(
          {
            ...AREA_SEAM.pane,
            size,
            get max() {
              return Math.min(AREA_SEAM.pane.max, frame.room);
            },
          },
          { onCommit: (committed) => frame.resize(committed) },
        ),
    );
  });

  $effect(() => {
    if (!panes.showing) return;
    const shown = seam;
    return untrack(() => frame.show('area', shown));
  });
</script>

{#if panes.showing}
  <SeamHandle {seam} label="Resize the area beside" contained />
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    class="flex min-h-0 min-w-0 shrink-0 flex-col border-l bg-background outline-none"
    style:width="{seam.size}px"
    tabindex="-1"
    aria-label="Tabs beside"
    data-side-pane={activeKey}
    onpointerdowncapture={() => panes.focusOn(activeKey)}
    onfocusin={() => panes.focusOn(activeKey)}
  >
    <div class="relative min-h-0 min-w-0 flex-1">
      <PaneStack />
    </div>
  </aside>
{/if}
