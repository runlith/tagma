<script lang="ts">
  import FileText from '@lucide/svelte/icons/file-text';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { PageStates } from './PageStates.svelte.js';

  let { pane }: { pane: SidePane } = $props();

  const states = PageStates.use();

  $effect(() => {
    if (pane.id !== null) return states.hold(pane.id);
  });

  const title = $derived(pane.id === null ? undefined : states.state(pane.id)?.current?.title);
</script>

<FileText class="size-3.5 shrink-0" />
<FadeText text={title ?? 'Page'} />
