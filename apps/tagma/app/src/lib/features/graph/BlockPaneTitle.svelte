<script lang="ts">
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { BlockTitles } from './BlockTitles.svelte.js';
  import { placedBlockOf } from './blockPane.js';

  let { pane }: { pane: SidePane } = $props();

  const titles = BlockTitles.use();
  const placed = $derived(placedBlockOf(pane.id));
  const label = $derived.by(() => {
    if (placed === null) return 'Block';
    const peer = titles.peer(placed.name);
    return peer == null || 'error' in peer ? placed.name : peer.title.trim() || placed.name;
  });
</script>

<StickyNote class="size-3.5 shrink-0" />
<FadeText text={label} />
