<script lang="ts">
  import SquarePlus from '@lucide/svelte/icons/square-plus';
  import Badge from '$lib/shared/ui/Badge.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import PanelIcon from '$lib/shared/ui/PanelIcon.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Keymap } from '../keys/Keymap.svelte.js';
  import { areaChord } from './areaChord.js';
  import NewTab from './NewTab.svelte';
  import { SidePanes } from './SidePanes.svelte.js';

  const panes = SidePanes.use();
  const keymap = Keymap.use();
  const chord = keymap.spell(areaChord(keymap));
  const count = $derived(panes.panes.length);
</script>

{#if count === 0}
  <NewTab label="New tab" align="end">
    {#snippet trigger()}<SquarePlus class="size-4" />{/snippet}
  </NewTab>
{:else}
  <Tooltip text={panes.showing ? 'Hide tabs' : 'Show tabs'} keys={chord}>
    <Button
      variant="quiet"
      size="icon-sm"
      class="no-drag-region relative"
      aria-label={panes.showing ? 'Hide tabs' : `Show ${count} ${count === 1 ? 'tab' : 'tabs'}`}
      aria-expanded={panes.showing}
      data-area-toggle={count}
      onclick={() => panes.showArea(!panes.showing)}
    >
      <Badge {count} class="-top-px -right-px"><PanelIcon side="right" class="size-4" /></Badge>
    </Button>
  </Tooltip>
{/if}
