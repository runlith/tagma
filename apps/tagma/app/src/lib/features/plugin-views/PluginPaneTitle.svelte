<script lang="ts">
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { paneOf } from './panes.js';
  import { ViewSets } from './ViewSets.svelte.js';

  let { pane }: { pane: SidePane } = $props();

  const sets = ViewSets.use();
  const target = $derived(paneOf(pane.id));
  const title = $derived(target === null ? undefined : sets.pane(target.plugin, target.view)?.title);
</script>

<Puzzle class="size-3.5 shrink-0" />
<FadeText text={title ?? pane.id ?? 'Plugin'} />
