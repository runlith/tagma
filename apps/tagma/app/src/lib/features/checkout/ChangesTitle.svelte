<script lang="ts">
  import FileDiff from '@lucide/svelte/icons/file-diff';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';

  let {}: { pane: SidePane } = $props();
</script>

<FileDiff class="size-3.5 shrink-0" />
<FadeText text="Changes" />
